#!/usr/bin/env node
'use strict';

/**
 * Ralph Loop orchestrator.
 *
 * One Claude session per issue; one branch per phase, merged with --no-ff into a
 * long-lived feature branch and tagged so phases stay revertable during development.
 * Nothing reaches the default branch automatically: when every phase is done the loop
 * opens a single pull request and stops, leaving the merge to a human.
 *
 * Design: docs/ralph-loop-rework/plan.md. Usage: docs/ralph-loop-rework/usage.md.
 * There is deliberately no Stop hook: this process owns the loop from start to finish.
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

function log(line) {
  const text = `[${new Date().toTimeString().slice(0, 8)}] ${line}`;
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

const refExists = (ref) =>
  gitTry('rev-parse', '--verify', '--quiet', ref).code === 0;
const isAncestor = (a, b) =>
  gitTry('merge-base', '--is-ancestor', a, b).code === 0;

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

Фазы копятся в фича-ветке, каждая — merge-коммит с тегом (точка отката).
В master ничего не мержится: когда фазы кончатся, цикл откроет один PR и остановится.

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
        break;
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
  if (!cfg.featureBranch) fail(`В ${file} не задан featureBranch`);
  return {
    active: cfg.active !== false,
    featureBranch: cfg.featureBranch,
    featureTitle: cfg.featureTitle || cfg.featureBranch,
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

function issuesOf(milestone, state) {
  const raw = gh(
    'issue',
    'list',
    '--milestone',
    milestone,
    '--state',
    state,
    '--limit',
    '200',
    '--json',
    'number,title',
  ).stdout;
  return JSON.parse(raw || '[]').sort((a, b) => a.number - b.number);
}

const openIssues = (milestone) => issuesOf(milestone, 'open');

function findPr(head, state) {
  const raw = ghTry(
    'pr',
    'list',
    '--head',
    head,
    '--state',
    state,
    '--limit',
    '5',
    '--json',
    'number,url,state',
  ).stdout;
  return JSON.parse(raw || '[]')[0] || null;
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

function fillPrompt(template, values) {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{${key}}`).join(String(value));
  }
  return out;
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

// ─── branches ──────────────────────────────────────────────────────────────────

const phaseTag = (phase) => `ralph/phase-${phase.index}`;

/** Long-lived feature branch: created from the default branch, kept in sync with it. */
function prepareFeatureBranch(cfg, base) {
  git('fetch', 'origin', '--prune', '--tags');

  if (!refExists(`refs/heads/${cfg.featureBranch}`)) {
    if (refExists(`refs/remotes/origin/${cfg.featureBranch}`)) {
      git('switch', '-c', cfg.featureBranch, `origin/${cfg.featureBranch}`);
    } else {
      git('switch', '-c', cfg.featureBranch, `origin/${base}`);
      log(`  фича-ветка ${cfg.featureBranch} создана от origin/${base}`);
      return;
    }
  } else {
    git('switch', cfg.featureBranch);
  }

  if (refExists(`refs/remotes/origin/${cfg.featureBranch}`)) {
    const pull = gitTry('merge', '--ff-only', `origin/${cfg.featureBranch}`);
    if (pull.code !== 0) {
      throw new Stop(
        `фича-ветка ${cfg.featureBranch} разошлась с origin — разберитесь вручную и перезапустите`,
      );
    }
  }

  if (isAncestor(`origin/${base}`, 'HEAD')) return;
  log(`  фича-ветка отстала от origin/${base} — вливаю`);
  if (gitTry('merge', '--no-edit', `origin/${base}`).code !== 0) {
    gitTry('merge', '--abort');
    throw new Stop(
      `${cfg.featureBranch} конфликтует с ${base} — разрешите вручную и перезапустите`,
    );
  }
}

/** Phase branch: cut from the feature branch, never from the default branch. */
function preparePhaseBranch(phase, cfg) {
  const exists =
    refExists(`refs/heads/${phase.branch}`) ||
    refExists(`refs/remotes/origin/${phase.branch}`);

  if (!exists) {
    git('switch', '-c', phase.branch, cfg.featureBranch);
    log(`  ветка ${phase.branch} создана от ${cfg.featureBranch}`);
    return;
  }

  if (!refExists(`refs/heads/${phase.branch}`)) {
    git('switch', '-c', phase.branch, `origin/${phase.branch}`);
  } else {
    git('switch', phase.branch);
  }

  if (isAncestor(cfg.featureBranch, 'HEAD')) {
    log(`  ветка ${phase.branch} переиспользована`);
    return;
  }
  log(`  ветка ${phase.branch} отстала от ${cfg.featureBranch} — вливаю`);
  if (gitTry('merge', '--no-edit', cfg.featureBranch).code !== 0) {
    gitTry('merge', '--abort');
    throw new Stop(
      `${phase.branch} конфликтует с ${cfg.featureBranch} — разрешите вручную и перезапустите`,
    );
  }
}

/**
 * A phase counts as merged when its commits are already reachable from the trunk the
 * feature branch grows on. Before that branch exists the trunk is the default branch —
 * that is how phases merged under an earlier scheme (phase 1 went straight to master)
 * are recognised instead of being replayed.
 */
function phaseIsMerged(phase, cfg, base) {
  if (refExists(`refs/tags/${phaseTag(phase)}`)) return true;

  const local = refExists(`refs/heads/${phase.branch}`);
  const remote = refExists(`refs/remotes/origin/${phase.branch}`);
  if (!local && !remote) return true; // нечего вливать: ветки фазы не существует

  const trunk = refExists(`refs/heads/${cfg.featureBranch}`)
    ? cfg.featureBranch
    : `origin/${base}`;
  const tip = local ? phase.branch : `origin/${phase.branch}`;
  return isAncestor(tip, trunk);
}

// ─── green gate ────────────────────────────────────────────────────────────────

function runGreenGate() {
  for (const task of ['lint', 'test']) {
    log(`  прогон pnpm ${task}`);
    const [file, args, extra] = shimSpawnArgs('pnpm', [task]);
    const r = spawnSync(file, args, {
      stdio: ['ignore', 'inherit', 'inherit'],
      ...extra,
    });
    if (r.status !== 0) return task;
  }
  return null;
}

// ─── phase execution ───────────────────────────────────────────────────────────

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
      stallSeconds: cfg.stallSeconds,
      prompt: fillPrompt(cfg.implPrompt, {
        milestone: phase.milestone,
        branch: phase.branch,
        issue: issue.number,
        title: issue.title,
      }),
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

async function reviewPhase(phase, cfg, opts, budget) {
  for (let round = 1; ; round++) {
    checkInterrupt();
    if (round > cfg.maxReviewRounds) {
      throw new Stop(
        `фаза «${phase.milestone}» не проходит ревью за ${cfg.maxReviewRounds} раунда — ветка ${phase.branch} не влита`,
      );
    }
    log(
      `▶ ревью фазы · раунд ${round}/${cfg.maxReviewRounds} · ${cfg.reviewModel}`,
    );

    const st = await runSession({
      model: cfg.reviewModel,
      maxTurns: cfg.maxTurns,
      stallSeconds: cfg.stallSeconds,
      prompt: fillPrompt(cfg.reviewPrompt, {
        milestone: phase.milestone,
        branch: phase.branch,
        featureBranch: cfg.featureBranch,
        range: `${cfg.featureBranch}...${phase.branch}`,
      }),
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
    if (stillOpen.length === 0) {
      // Вердикт без заведённых issue означает, что ревью нашло блокирующее, но не
      // оставило следа, по которому цикл мог бы это починить. Вливать нельзя.
      if (verdict === 'BLOCKED') {
        throw new Stop(
          `ревью вынесло BLOCKED, но не завело ни одного issue — фаза «${phase.milestone}» не влита, смотрите ${LOG_FILE}`,
        );
      }
      return;
    }

    log(
      `  ревью завело ${stillOpen.length} follow-up issue — возвращаюсь к реализации`,
    );
    await drainIssues(phase, cfg, opts, budget);
  }
}

async function runPhase(phase, cfg, opts, base, budget) {
  const openBefore = openIssues(phase.milestone);
  if (openBefore.length === 0 && phaseIsMerged(phase, cfg, base)) {
    log(
      `⏭ фаза «${phase.milestone}» уже влита в ${cfg.featureBranch} — пропуск`,
    );
    return false;
  }

  budget.phaseTokens = 0;
  budget.phaseLimit =
    cfg.issueBudgetTokens * Math.max(1, openBefore.length) +
    cfg.reviewBudgetTokens * cfg.maxReviewRounds;

  log(
    `▶ Фаза ${phase.index} «${phase.milestone}» · ветка ${phase.branch} · ${openBefore.length} открытых issue · бюджет ${fmtTokens(budget.phaseLimit)}`,
  );

  prepareFeatureBranch(cfg, base);
  preparePhaseBranch(phase, cfg);

  await drainIssues(phase, cfg, opts, budget);
  await reviewPhase(phase, cfg, opts, budget);

  checkInterrupt();
  const failedTask = runGreenGate();
  if (failedTask) {
    throw new Stop(
      `pnpm ${failedTask} красный — ветка ${phase.branch} не влита, почините и перезапустите`,
    );
  }

  // Фаза вливается в фича-ветку отдельным merge-коммитом и помечается тегом:
  // это и есть точка отката до попадания фичи в master.
  git('switch', cfg.featureBranch);
  const merge = gitTry(
    'merge',
    '--no-ff',
    '-m',
    `merge(${phase.branch}): ${phase.milestone}`,
    phase.branch,
  );
  if (merge.code !== 0) {
    gitTry('merge', '--abort');
    git('switch', phase.branch);
    throw new Stop(
      `слияние ${phase.branch} в ${cfg.featureBranch} не прошло — разрешите вручную и перезапустите`,
    );
  }
  git('tag', '-f', phaseTag(phase));
  git('push', '-u', 'origin', cfg.featureBranch);
  git('push', '-f', 'origin', phaseTag(phase));

  log(
    `✓ фаза ${phase.index} влита в ${cfg.featureBranch} · тег ${phaseTag(phase)} · ${fmtTokens(budget.phaseTokens)} за фазу`,
  );
  return true;
}

// ─── final pull request ────────────────────────────────────────────────────────

function maybeOpenFeaturePr(cfg, allPhases, base) {
  const unfinished = allPhases.filter(
    (p) => openIssues(p.milestone).length > 0 || !phaseIsMerged(p, cfg, base),
  );
  if (unfinished.length > 0) {
    log(
      `· фича не завершена: осталось фаз ${unfinished.length} — финальный PR не создаётся`,
    );
    return;
  }

  const existing = findPr(cfg.featureBranch, 'open');
  if (existing) {
    log(`· финальный PR уже открыт: ${existing.url}`);
    return;
  }

  const sections = allPhases.map((p) => {
    const rows = issuesOf(p.milestone, 'all')
      .map((i) => `| #${i.number} | ${i.title} |`)
      .join('\n');
    return [
      `### Фаза ${p.index}: ${p.milestone}`,
      '',
      '| Issue | Что |',
      '| --- | --- |',
      rows,
      '',
    ].join('\n');
  });

  const body = [
    `Реализует **${cfg.featureTitle}** целиком.`,
    '',
    'Каждая фаза влита в эту ветку отдельным merge-коммитом и помечена тегом',
    `\`ralph/phase-N\` — до мержа в \`${base}\` фазы можно откатывать по одной.`,
    '',
    '**Мержить merge-коммитом, не squash** — иначе история по issue схлопнется.',
    '',
    ...sections,
    '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
  ].join('\n');

  git('push', '-u', 'origin', cfg.featureBranch);
  const url = gh(
    'pr',
    'create',
    '--base',
    base,
    '--head',
    cfg.featureBranch,
    '--title',
    `feat: ${cfg.featureTitle}`,
    '--body',
    body,
  ).stdout;
  log(`✓ все фазы готовы · финальный PR открыт: ${url}`);
  log('  мерж — за вами; оркестратор в master ничего не пишет');
}

// ─── dry run ───────────────────────────────────────────────────────────────────

function printPlan(phases, cfg, base) {
  const perIssue = estimateIssueTokens();
  const baseline = perIssue === BASELINE_ISSUE_TOKENS;
  let issues = 0;
  let tokens = 0;
  let sessions = 0;
  let planned = 0;

  console.log(
    `\nФича-ветка: ${cfg.featureBranch} → PR в ${base} (мержите вы)\n` +
      `Оценка: ${fmtTokens(perIssue)} на issue${baseline ? ' (базовая линия, статистики пока нет)' : ` (медиана по ${STATS_FILE})`}\n`,
  );

  for (const phase of phases) {
    const open = openIssues(phase.milestone);
    if (open.length === 0 && phaseIsMerged(phase, cfg, base)) {
      console.log(`  ⏭ ${phase.milestone} — уже влита`);
      continue;
    }
    planned++;
    const phaseTokens = perIssue * open.length + BASELINE_REVIEW_TOKENS;
    const phaseSessions =
      open.length * cfg.maxIssueAttempts + cfg.maxReviewRounds;
    issues += open.length;
    tokens += phaseTokens;
    sessions += phaseSessions;
    console.log(
      `  ${String(open.length).padStart(2)} issue  ~${fmtTokens(phaseTokens).padStart(6)} вх  ≤ ${String(phaseSessions).padStart(2)} сессий   ${phase.milestone}`,
    );
  }

  console.log(
    `\nИтого: ${planned} фаз, ${issues} issue, ~${fmtTokens(tokens)} входных токенов, максимум ${sessions} сессий`,
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

  const allPhases = cfg.phases.map((p, i) => ({ ...p, index: i + 1 }));
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
    `▶ Ralph Loop · фича-ветка ${cfg.featureBranch} · база ${base} · модели ${cfg.implModel}/${cfg.reviewModel} · maxTurns ${cfg.maxTurns}`,
  );

  try {
    for (const phase of phases) {
      if (opts.phases !== null && executed >= opts.phases) {
        log(`⏹ достигнут предел --phases ${opts.phases}`);
        break;
      }
      checkInterrupt();
      if (await runPhase(phase, cfg, opts, base, budget)) executed++;
    }
    maybeOpenFeaturePr(cfg, allPhases, base);
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
