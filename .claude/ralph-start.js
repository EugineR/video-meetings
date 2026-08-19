#!/usr/bin/env node
'use strict';

/**
 * Ralph Loop orchestrator.
 *
 * Runs one Claude session per issue, one PR per phase, merging each phase into the
 * default branch. Design: docs/ralph-loop-rework/plan.md. Usage: docs/ralph-loop-rework/usage.md.
 *
 * There is no Stop hook involved: this process owns the loop from start to finish.
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');

const CONFIG_DEFAULT = '.claude/ralph.config.json';
const LOG_FILE = '.claude/ralph.log';
const STATS_FILE = '.claude/ralph.stats.jsonl';
const STOP_FILE = '.claude/ralph.stop';
const IS_WIN = process.platform === 'win32';

// Baseline from docs/ralph-loop-rework/plan.md §3, used until ralph.stats.jsonl has samples.
const BASELINE_ISSUE_TOKENS = 1_800_000;
const BASELINE_REVIEW_TOKENS = 4_000_000;

let stopRequested = false;
let currentChild = null;

class Stop extends Error {}

// ─── infrastructure ────────────────────────────────────────────────────────────

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function stamp() {
  return new Date().toTimeString().slice(0, 8);
}

function log(line) {
  const text = `[${stamp()}] ${line}`;
  console.log(text);
  try {
    fs.appendFileSync(LOG_FILE, text + '\n');
  } catch {
    /* логирование не должно ронять прогон */
  }
}

function fmtTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
}

function fmtDuration(ms) {
  const total = Math.round(ms / 1000);
  if (total < 60) return total + 'с';
  return (
    Math.floor(total / 60) + 'м' + String(total % 60).padStart(2, '0') + 'с'
  );
}

function sleep(ms) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = setInterval(() => {
      if (stopRequested || Date.now() - started >= ms) {
        clearInterval(tick);
        resolve();
      }
    }, 1000);
  });
}

/**
 * git and gh are real executables: spawn them directly so Node quotes arguments
 * itself (milestone titles contain spaces and `&`). Only .cmd shims need cmd.exe.
 */
function exec(file, args, { allowFail = false } = {}) {
  const r = spawnSync(file, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) {
    if (allowFail) return { code: -1, stdout: '', stderr: r.error.message };
    fail(`${file}: ${r.error.message}`);
  }
  if (r.status !== 0 && !allowFail) {
    fail(
      `${file} ${args.join(' ')} → код ${r.status}\n${(r.stderr || r.stdout || '').trim()}`,
    );
  }
  return {
    code: r.status,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
  };
}

const git = (...args) => exec('git', args);
const gitTry = (...args) => exec('git', args, { allowFail: true });
const gh = (...args) => exec('gh', args);
const ghTry = (...args) => exec('gh', args, { allowFail: true });

/** Wraps a .cmd shim (claude, pnpm) for spawn. Only safe for simple arguments. */
function shimSpawnArgs(file, args) {
  if (!IS_WIN) return [file, args, {}];
  return [
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', `"${file}" ${args.join(' ')}`],
    { windowsVerbatimArguments: true },
  ];
}

// ─── config and CLI ────────────────────────────────────────────────────────────

function usage() {
  console.log(`
Ralph Loop — автономный цикл по issue и фазам.

  node .claude/ralph-start.js [опции]

  --dry-run          показать состав прогона и оценку расхода, ничего не запуская
  --phases N         выполнить максимум N фаз (считаются только фактически выполненные)
  --only <n|имя>     выполнить ровно одну фазу: номер в конфиге или подстрока milestone
  --issues N         остановиться после N закрытых issue, даже посреди фазы
  --branch <имя>     переопределить ветку фазы; только вместе с --only
  --stop-on-limit    при упоре в rate limit остановиться, а не ждать сброса окна
  --config <путь>    другой каталог фаз (по умолчанию ${CONFIG_DEFAULT})

Остановка: Ctrl-C (мягко), Ctrl-C дважды (жёстко), либо создать ${STOP_FILE}.
`);
}

function parseArgs(argv) {
  const opts = {
    config: CONFIG_DEFAULT,
    phases: null,
    only: null,
    issues: null,
    branch: null,
    dryRun: false,
    stopOnLimit: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) fail(`Флаг ${flag} требует значения`);
      return v;
    };
    switch (flag) {
      case '--config':
        opts.config = value();
        break;
      case '--phases':
        opts.phases = Number(value());
        break;
      case '--only':
        opts.only = value();
        break;
      case '--issues':
        opts.issues = Number(value());
        break;
      case '--branch':
        opts.branch = value();
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--stop-on-limit':
        opts.stopOnLimit = true;
        break;
      case '-h':
      case '--help':
        usage();
        process.exit(0);
      // eslint-disable-next-line no-fallthrough
      default:
        fail(`Неизвестный флаг: ${flag}`);
    }
  }
  if (opts.branch && !opts.only)
    fail('--branch допустим только вместе с --only');
  if (opts.phases !== null && !(opts.phases > 0))
    fail('--phases требует положительное число');
  if (opts.issues !== null && !(opts.issues > 0))
    fail('--issues требует положительное число');
  return opts;
}

function loadConfig(file) {
  if (!fs.existsSync(file)) fail(`Конфиг не найден: ${file}`);
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(cfg.phases) || cfg.phases.length === 0)
    fail(`В ${file} нет фаз`);
  return {
    active: cfg.active !== false,
    implModel: cfg.implModel || 'sonnet',
    reviewModel: cfg.reviewModel || 'opus',
    maxTurns: cfg.maxTurns || 100,
    maxIssueAttempts: cfg.maxIssueAttempts || 2,
    maxReviewRounds: cfg.maxReviewRounds || 3,
    issueBudgetTokens: cfg.issueBudgetTokens || 6_000_000,
    reviewBudgetTokens: cfg.reviewBudgetTokens || 4_000_000,
    stallSeconds: cfg.stallSeconds || 120,
    onRateLimit: cfg.onRateLimit || 'wait',
    implPrompt: cfg.implPrompt,
    reviewPrompt: cfg.reviewPrompt,
    phases: cfg.phases,
  };
}

// ─── GitHub ────────────────────────────────────────────────────────────────────

function openIssues(milestone) {
  const raw = gh(
    'issue',
    'list',
    '--milestone',
    milestone,
    '--state',
    'open',
    '--limit',
    '200',
    '--json',
    'number,title',
  ).stdout;
  const list = JSON.parse(raw || '[]');
  return list.sort((a, b) => a.number - b.number); // возрастание = порядок TDD
}

function milestoneIssues(milestone) {
  const raw = gh(
    'issue',
    'list',
    '--milestone',
    milestone,
    '--state',
    'all',
    '--limit',
    '200',
    '--json',
    'number,title',
  ).stdout;
  return JSON.parse(raw || '[]').sort((a, b) => a.number - b.number);
}

function findPr(branch, state) {
  const raw = ghTry(
    'pr',
    'list',
    '--head',
    branch,
    '--state',
    state,
    '--limit',
    '5',
    '--json',
    'number,url,state',
  ).stdout;
  const list = JSON.parse(raw || '[]');
  return list[0] || null;
}

// ─── session runner ────────────────────────────────────────────────────────────

function describeTool(part) {
  const input = part.input || {};
  const brief =
    input.command || input.file_path || input.pattern || input.path || '';
  const text = String(brief).replace(/\s+/g, ' ').slice(0, 70);
  return part.name + (text ? ': ' + text : '');
}

/**
 * Runs one `claude -p` session. The prompt goes through stdin, so no shell escaping
 * is involved and the hook-payload leak of the old Stop hook cannot recur.
 */
function runSession({ model, maxTurns, prompt, stallSeconds }) {
  return new Promise((resolve) => {
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--model',
      model,
      '--max-turns',
      String(maxTurns),
    ];
    const [file, spawnArgs, extra] = shimSpawnArgs('claude', args);
    const child = spawn(file, spawnArgs, {
      stdio: ['pipe', 'pipe', 'inherit'],
      ...extra,
    });
    currentChild = child;

    const started = Date.now();
    const st = {
      turns: 0,
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      terminalReason: null,
      denials: [],
      rateLimit: null,
      resultText: '',
      isError: false,
      apiErrorStatus: null,
      lastTool: null,
    };

    let lastEventAt = Date.now();
    let stallWarned = false;
    let lastPrintAt = Date.now();
    let buffer = '';

    const watchdog = setInterval(() => {
      const idleSec = (Date.now() - lastEventAt) / 1000;
      if (idleSec > stallSeconds * 3) {
        log(`  ⚠ нет событий ${Math.round(idleSec)}с — сессия убита`);
        st.terminalReason = 'stalled';
        try {
          child.kill();
        } catch {
          /* уже мёртв */
        }
      } else if (idleSec > stallSeconds && !stallWarned) {
        stallWarned = true;
        log(
          `  ⚠ нет событий ${Math.round(idleSec)}с · последнее: ${st.lastTool || 'старт сессии'}`,
        );
      }
    }, 5000);

    child.stdin.write(prompt);
    child.stdin.end();

    child.stdout.on('data', (chunk) => {
      lastEventAt = Date.now();
      stallWarned = false;
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }

        if (ev.type === 'rate_limit_event' && ev.rate_limit_info) {
          st.rateLimit = ev.rate_limit_info;
        }
        if (ev.type === 'assistant' && ev.message) {
          st.turns++;
          const u = ev.message.usage || {};
          st.inputTokens +=
            (u.input_tokens || 0) +
            (u.cache_creation_input_tokens || 0) +
            (u.cache_read_input_tokens || 0);
          st.outputTokens += u.output_tokens || 0;
          for (const part of ev.message.content || []) {
            if (part.type === 'tool_use') st.lastTool = describeTool(part);
          }
          if (Date.now() - lastPrintAt > 20000) {
            lastPrintAt = Date.now();
            log(
              `  · ${st.turns} турнов · ${fmtTokens(st.inputTokens)} вх · ${fmtTokens(st.outputTokens)} вых · ${st.lastTool || '…'}`,
            );
          }
        }
        if (ev.type === 'result') {
          st.terminalReason = st.terminalReason || ev.terminal_reason || null;
          st.denials = ev.permission_denials || [];
          st.cost = ev.total_cost_usd || 0;
          st.isError = !!ev.is_error;
          st.apiErrorStatus = ev.api_error_status || null;
          st.resultText = typeof ev.result === 'string' ? ev.result : '';
        }
      }
    });

    child.on('close', (code) => {
      clearInterval(watchdog);
      currentChild = null;
      st.exitCode = code;
      st.durationMs = Date.now() - started;
      resolve(st);
    });
  });
}

function recordStats(kind, phase, issueNumber, st) {
  const row = {
    at: new Date().toISOString(),
    kind,
    phase: phase.milestone,
    issue: issueNumber,
    terminalReason: st.terminalReason,
    turns: st.turns,
    inputTokens: st.inputTokens,
    outputTokens: st.outputTokens,
    costUsd: st.cost,
    durationMs: st.durationMs,
    exitCode: st.exitCode,
  };
  try {
    fs.appendFileSync(STATS_FILE, JSON.stringify(row) + '\n');
  } catch {
    /* не критично */
  }
}

/** Median input tokens of past implementation sessions, or the §3 baseline. */
function estimateIssueTokens() {
  if (!fs.existsSync(STATS_FILE)) return BASELINE_ISSUE_TOKENS;
  const samples = fs
    .readFileSync(STATS_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((r) => r && r.kind === 'impl' && r.inputTokens > 0)
    .map((r) => r.inputTokens)
    .sort((a, b) => a - b);
  if (samples.length < 3) return BASELINE_ISSUE_TOKENS;
  return samples[Math.floor(samples.length / 2)];
}

// ─── prompts ───────────────────────────────────────────────────────────────────

function implPrompt(cfg, phase, issue) {
  const template = cfg.implPrompt;
  return template
    .split('{milestone}')
    .join(phase.milestone)
    .split('{branch}')
    .join(phase.branch)
    .split('{issue}')
    .join(String(issue.number))
    .split('{title}')
    .join(issue.title);
}

function reviewPrompt(cfg, phase, prNumber) {
  const template = cfg.reviewPrompt;
  return template
    .split('{milestone}')
    .join(phase.milestone)
    .split('{branch}')
    .join(phase.branch)
    .split('{pr}')
    .join(String(prNumber));
}

// ─── rate limit ────────────────────────────────────────────────────────────────

async function handleRateLimit(st, cfg, opts) {
  const info = st.rateLimit;
  if (!info || info.status === 'allowed') return;
  if (opts.stopOnLimit || cfg.onRateLimit === 'stop') {
    throw new Stop(
      `упор в rate limit (${info.rateLimitType}) — остановка по настройке`,
    );
  }
  const resetAt = (info.resetsAt || 0) * 1000;
  const waitMs = Math.max(0, resetAt - Date.now()) + 15000;
  log(
    `⏳ лимит ${info.rateLimitType} исчерпан · жду сброса до ${new Date(resetAt).toTimeString().slice(0, 8)} (${fmtDuration(waitMs)})`,
  );
  await sleep(waitMs);
}

function checkInterrupt() {
  if (stopRequested) throw new Stop('остановлено по Ctrl-C');
  if (fs.existsSync(STOP_FILE))
    throw new Stop(`найден ${STOP_FILE} — остановка`);
}

// ─── phase execution ───────────────────────────────────────────────────────────

function prepareBranch(phase, base) {
  git('fetch', 'origin', '--prune');
  git('switch', base);
  git('pull', '--ff-only');

  const existsLocal =
    gitTry('rev-parse', '--verify', '--quiet', `refs/heads/${phase.branch}`)
      .code === 0;
  const existsRemote =
    gitTry(
      'rev-parse',
      '--verify',
      '--quiet',
      `refs/remotes/origin/${phase.branch}`,
    ).code === 0;

  if (!existsLocal && !existsRemote) {
    git('switch', '-c', phase.branch, `origin/${base}`);
    log(`  ветка ${phase.branch} создана от origin/${base}`);
    return;
  }

  if (!existsLocal) git('switch', '-c', phase.branch, `origin/${phase.branch}`);
  else git('switch', phase.branch);

  const upToDate =
    gitTry('merge-base', '--is-ancestor', `origin/${base}`, 'HEAD').code === 0;
  if (upToDate) {
    log(`  ветка ${phase.branch} переиспользована, base актуален`);
    return;
  }
  log(`  ветка ${phase.branch} отстала от origin/${base} — вливаю`);
  const merged = gitTry('merge', '--no-edit', `origin/${base}`);
  if (merged.code !== 0) {
    throw new Stop(
      `ветка ${phase.branch} отстала от ${base}, автослияние не прошло — разрешите конфликт вручную и перезапустите`,
    );
  }
}

function buildPrBody(phase, issues) {
  const rows = issues.map((i) => `| #${i.number} | ${i.title} |`).join('\n');
  return [
    `Реализует **${phase.milestone}**.`,
    '',
    '| Issue | Что |',
    '| --- | --- |',
    rows,
    '',
    issues.map((i) => `Closes #${i.number}`).join(', '),
    '',
    '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
  ].join('\n');
}

function runGreenGate() {
  for (const task of [['lint'], ['test']]) {
    log(`  прогон pnpm ${task[0]}`);
    const [file, args, extra] = shimSpawnArgs('pnpm', task);
    const r = spawnSync(file, args, {
      stdio: ['ignore', 'inherit', 'inherit'],
      ...extra,
    });
    if (r.status !== 0) return task[0];
  }
  return null;
}

/** Runs implementation sessions until the milestone has no open issues left. */
async function drainIssues(phase, cfg, opts, budget) {
  const attempts = new Map();
  let open = openIssues(phase.milestone);

  while (open.length > 0) {
    checkInterrupt();
    if (opts.issues !== null && budget.issuesClosed >= opts.issues) {
      throw new Stop(`достигнут предел --issues ${opts.issues}`);
    }
    if (budget.phaseTokens > budget.phaseLimit) {
      throw new Stop(
        `фаза «${phase.milestone}» вышла за бюджет (${fmtTokens(budget.phaseTokens)} из ${fmtTokens(budget.phaseLimit)})`,
      );
    }

    const issue = open[0];
    const attempt = (attempts.get(issue.number) || 0) + 1;
    attempts.set(issue.number, attempt);

    log(
      `▶ issue #${issue.number} «${issue.title}» · попытка ${attempt}/${cfg.maxIssueAttempts} · ${cfg.implModel} · maxTurns ${cfg.maxTurns}`,
    );

    const st = await runSession({
      model: cfg.implModel,
      maxTurns: cfg.maxTurns,
      prompt: implPrompt(cfg, phase, issue),
      stallSeconds: cfg.stallSeconds,
    });
    recordStats('impl', phase, issue.number, st);
    budget.phaseTokens += st.inputTokens;
    budget.runTokens += st.inputTokens;
    budget.runCost += st.cost;

    const issueTokens =
      (budget.perIssue.get(issue.number) || 0) + st.inputTokens;
    budget.perIssue.set(issue.number, issueTokens);

    if (st.denials.length > 0) {
      throw new Stop(
        `сессия уткнулась в отсутствующее разрешение: ${JSON.stringify(st.denials).slice(0, 300)}\n` +
          '  добавьте его в permissions.allow в .claude/settings.json и перезапустите',
      );
    }
    await handleRateLimit(st, cfg, opts);

    open = openIssues(phase.milestone);
    const closed = !open.some((i) => i.number === issue.number);
    const summary = `${st.turns} турнов · ${fmtTokens(st.inputTokens)} вх · ${fmtTokens(st.outputTokens)} вых · ${fmtDuration(st.durationMs)} · ${st.terminalReason || 'нет result'} · всего за прогон ${fmtTokens(budget.runTokens)}`;

    if (closed) {
      budget.issuesClosed++;
      attempts.set(issue.number, 0);
      log(`✓ issue #${issue.number} закрыт · ${summary}`);
      continue;
    }

    log(`✗ issue #${issue.number} не закрыт · ${summary}`);
    if (issueTokens > cfg.issueBudgetTokens) {
      throw new Stop(
        `issue #${issue.number} вышла за бюджет (${fmtTokens(issueTokens)} из ${fmtTokens(cfg.issueBudgetTokens)}) — вероятно, её стоит разбить`,
      );
    }
    if (attempt >= cfg.maxIssueAttempts) {
      throw new Stop(
        `issue #${issue.number} не продвигается после ${attempt} попыток — посмотрите ${STATS_FILE} и комментарии в issue`,
      );
    }
  }
}

async function runPhase(phase, cfg, opts, base, budget) {
  const openBefore = openIssues(phase.milestone);
  const mergedPr = findPr(phase.branch, 'merged');
  if (openBefore.length === 0 && mergedPr) {
    log(
      `⏭ фаза «${phase.milestone}» уже завершена (PR #${mergedPr.number}) — пропуск`,
    );
    return false;
  }

  budget.phaseTokens = 0;
  budget.phaseLimit =
    cfg.issueBudgetTokens * Math.max(1, openBefore.length) +
    cfg.reviewBudgetTokens * cfg.maxReviewRounds;

  log(
    `▶ Фаза «${phase.milestone}» · ветка ${phase.branch} · ${openBefore.length} открытых issue · бюджет ${fmtTokens(budget.phaseLimit)}`,
  );
  prepareBranch(phase, base);

  await drainIssues(phase, cfg, opts, budget);

  // ─── публикация ───
  checkInterrupt();
  git('push', '-u', 'origin', phase.branch);
  let pr = findPr(phase.branch, 'open');
  if (!pr) {
    const issues = milestoneIssues(phase.milestone);
    const url = gh(
      'pr',
      'create',
      '--base',
      base,
      '--head',
      phase.branch,
      '--title',
      `feat: ${phase.milestone}`,
      '--body',
      buildPrBody(phase, issues),
    ).stdout;
    pr = findPr(phase.branch, 'open');
    log(`✓ PR создан: ${url}`);
  } else {
    log(`· PR #${pr.number} уже существует: ${pr.url}`);
  }
  if (!pr) throw new Stop('PR создан, но не найден через gh pr list');

  // ─── ревью ───
  for (let round = 1; ; round++) {
    checkInterrupt();
    if (round > cfg.maxReviewRounds) {
      throw new Stop(
        `фаза «${phase.milestone}» не проходит ревью за ${cfg.maxReviewRounds} раунда — PR #${pr.number} оставлен открытым`,
      );
    }
    log(
      `▶ ревью PR #${pr.number} · раунд ${round}/${cfg.maxReviewRounds} · ${cfg.reviewModel}`,
    );
    const st = await runSession({
      model: cfg.reviewModel,
      maxTurns: cfg.maxTurns,
      prompt: reviewPrompt(cfg, phase, pr.number),
      stallSeconds: cfg.stallSeconds,
    });
    recordStats('review', phase, null, st);
    budget.phaseTokens += st.inputTokens;
    budget.runTokens += st.inputTokens;
    budget.runCost += st.cost;

    if (st.denials.length > 0) {
      throw new Stop(
        `ревью уткнулось в отсутствующее разрешение: ${JSON.stringify(st.denials).slice(0, 300)}`,
      );
    }
    await handleRateLimit(st, cfg, opts);

    const verdict = /(^|\n)\s*BLOCKED/i.test(st.resultText)
      ? 'BLOCKED'
      : 'APPROVED';
    log(
      `  ревью: ${verdict} · ${st.turns} турнов · ${fmtTokens(st.inputTokens)} вх · ${fmtDuration(st.durationMs)}`,
    );

    const stillOpen = openIssues(phase.milestone);
    if (stillOpen.length === 0) break;

    log(
      `  ревью завело ${stillOpen.length} follow-up issue — возвращаюсь к реализации`,
    );
    await drainIssues(phase, cfg, opts, budget);
    git('push', 'origin', phase.branch);
  }

  // ─── зелёный гейт ───
  checkInterrupt();
  const failedTask = runGreenGate();
  if (failedTask) {
    throw new Stop(
      `pnpm ${failedTask} красный — PR #${pr.number} оставлен открытым, почините и перезапустите`,
    );
  }

  // ─── мерж ───
  const merge = ghTry(
    'pr',
    'merge',
    String(pr.number),
    '--merge',
    '--delete-branch',
  );
  if (merge.code !== 0) {
    throw new Stop(
      `gh pr merge для PR #${pr.number} не прошёл:\n${merge.stderr || merge.stdout}`,
    );
  }
  log(
    `✓ фаза «${phase.milestone}» смержена в ${base} · PR #${pr.number} · ${fmtTokens(budget.phaseTokens)} за фазу`,
  );
  return true;
}

// ─── dry run ───────────────────────────────────────────────────────────────────

function printPlan(phases, cfg, base) {
  const perIssue = estimateIssueTokens();
  const usingBaseline = perIssue === BASELINE_ISSUE_TOKENS;
  let totalIssues = 0;
  let totalTokens = 0;
  let totalSessions = 0;
  let planned = 0;

  console.log(
    `\nЦелевая ветка: ${base}\nОценка: ${fmtTokens(perIssue)} на issue${usingBaseline ? ' (базовая линия, статистики пока нет)' : ' (медиана по ' + STATS_FILE + ')'}\n`,
  );

  for (const phase of phases) {
    const open = openIssues(phase.milestone);
    if (open.length === 0 && findPr(phase.branch, 'merged')) {
      console.log(`  ⏭ ${phase.milestone} — уже завершена`);
      continue;
    }
    planned++;
    const tokens = perIssue * open.length + BASELINE_REVIEW_TOKENS;
    const sessions = open.length * cfg.maxIssueAttempts + cfg.maxReviewRounds;
    totalIssues += open.length;
    totalTokens += tokens;
    totalSessions += sessions;
    console.log(
      `  ${String(open.length).padStart(2)} issue  ~${fmtTokens(tokens).padStart(6)} вх  ≤ ${String(sessions).padStart(2)} сессий   ${phase.milestone}`,
    );
  }

  console.log(
    `\nИтого: ${planned} фаз, ${totalIssues} issue, ~${fmtTokens(totalTokens)} входных токенов, максимум ${totalSessions} сессий`,
  );
  console.log('Ни одна сессия не запущена.\n');
}

// ─── main ──────────────────────────────────────────────────────────────────────

function selectPhases(cfg, opts) {
  const all = cfg.phases.map((p, i) => ({ ...p, index: i + 1 }));
  if (!opts.only) return all;

  const asNumber = Number(opts.only);
  const found = Number.isInteger(asNumber)
    ? all.find((p) => p.index === asNumber)
    : all.find((p) =>
        p.milestone.toLowerCase().includes(String(opts.only).toLowerCase()),
      );
  if (!found) fail(`Фаза не найдена: ${opts.only}`);

  const skipped = all.filter(
    (p) => p.index < found.index && openIssues(p.milestone).length > 0,
  );
  if (skipped.length > 0) {
    log(
      `⚠ --only пропускает незакрытые фазы: ${skipped.map((p) => '#' + p.index).join(', ')} — фазы зависимы, убедитесь, что это осознанно`,
    );
  }
  if (opts.branch) found.branch = opts.branch;
  return [found];
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cfg = loadConfig(opts.config);

  if (fs.existsSync(STOP_FILE))
    fail(`Найден ${STOP_FILE} — удалите его, чтобы запустить цикл`);
  if (!cfg.active && !opts.dryRun)
    fail(`active: false в ${opts.config} — цикл выключен`);
  if (!cfg.implPrompt || !cfg.reviewPrompt)
    fail(`В ${opts.config} нет implPrompt / reviewPrompt`);

  const base = gh(
    'repo',
    'view',
    '--json',
    'defaultBranchRef',
    '-q',
    '.defaultBranchRef.name',
  ).stdout;
  if (!base) fail('Не удалось определить дефолтную ветку через gh');

  const phases = selectPhases(cfg, opts);

  if (opts.dryRun) {
    printPlan(phases, cfg, base);
    return;
  }

  const dirty = git('status', '--porcelain').stdout;
  if (dirty)
    fail(
      `Рабочее дерево не чистое — закоммитьте или спрячьте изменения:\n${dirty}`,
    );

  process.on('SIGINT', () => {
    if (stopRequested) {
      log('⛔ Ctrl-C повторно — убиваю сессию немедленно');
      if (currentChild) {
        try {
          currentChild.kill();
        } catch {
          /* уже мёртв */
        }
      }
      process.exit(130);
    }
    stopRequested = true;
    log(
      '⏸ Ctrl-C — текущая сессия доигрывает, следующая issue не берётся (ещё раз — убить сейчас)',
    );
  });

  const budget = {
    runTokens: 0,
    runCost: 0,
    issuesClosed: 0,
    phaseTokens: 0,
    phaseLimit: Infinity,
    perIssue: new Map(),
  };
  const startedAt = Date.now();
  let executed = 0;

  log(
    `▶ Ralph Loop · база ${base} · модели ${cfg.implModel}/${cfg.reviewModel} · maxTurns ${cfg.maxTurns}`,
  );

  try {
    for (const phase of phases) {
      if (opts.phases !== null && executed >= opts.phases) {
        log(`⏹ достигнут предел --phases ${opts.phases}`);
        break;
      }
      checkInterrupt();
      const didWork = await runPhase(phase, cfg, opts, base, budget);
      if (didWork) executed++;
    }
    log(
      `✔ прогон завершён · фаз выполнено ${executed} · issue закрыто ${budget.issuesClosed} · ${fmtTokens(budget.runTokens)} вх · $${budget.runCost.toFixed(2)} · ${fmtDuration(Date.now() - startedAt)}`,
    );
  } catch (err) {
    if (!(err instanceof Stop)) throw err;
    log(`⛔ СТОП: ${err.message}`);
    log(
      `  итог прогона: фаз ${executed} · issue ${budget.issuesClosed} · ${fmtTokens(budget.runTokens)} вх · $${budget.runCost.toFixed(2)} · ${fmtDuration(Date.now() - startedAt)}`,
    );
    log(
      `  ветка ${git('rev-parse', '--abbrev-ref', 'HEAD').stdout} оставлена как есть; повторный запуск продолжит с этой точки`,
    );
    process.exitCode = 1;
  }
}

main().catch((err) => fail(err.stack || String(err)));
