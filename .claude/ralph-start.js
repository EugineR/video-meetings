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
  console.error(`x ${message}`);
  process.exit(1);
}

function log(line) {
  const text = `[${new Date().toTimeString().slice(0, 8)}] ${line}`;
  console.log(text);
  try {
    fs.appendFileSync(LOG_FILE, text + '\n');
  } catch {
    /* logging must never break a run */
  }
}

function fmtTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
}

function fmtDuration(ms) {
  const total = Math.round(ms / 1000);
  if (total < 60) return total + 's';
  return (
    Math.floor(total / 60) + 'm' + String(total % 60).padStart(2, '0') + 's'
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
      `${file} ${args.join(' ')} exited ${r.status}\n${(r.stderr || r.stdout || '').trim()}`,
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
Ralph Loop - autonomous loop over issues and phases.

  node .claude/ralph-start.js [options]

  --dry-run          print the run plan and a cost estimate, start no sessions
  --phases N         run at most N phases (only phases actually executed count)
  --only <n|name>    run exactly one phase: its number in the config, or a
                     substring of its milestone title
  --issues N         stop after N closed issues, even mid-phase
  --branch <name>    override the phase branch; only together with --only
  --stop-on-limit    stop when the rate limit is hit instead of waiting for reset
  --config <path>    a different phase catalogue (default ${CONFIG_DEFAULT})

Phases accumulate on the feature branch, each as a merge commit with a tag - those
tags are the rollback points. Nothing is merged into the default branch: once every
phase is done the loop opens a single pull request and stops.

To stop: Ctrl-C (graceful), Ctrl-C twice (immediate), or create ${STOP_FILE}.
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
      if (v === undefined) fail(`Flag ${flag} needs a value`);
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
        fail(`Unknown flag: ${flag}`);
    }
  }
  if (opts.branch && !opts.only)
    fail('--branch is only allowed together with --only');
  if (opts.phases !== null && !(opts.phases > 0))
    fail('--phases needs a positive number');
  if (opts.issues !== null && !(opts.issues > 0))
    fail('--issues needs a positive number');
  return opts;
}

function loadConfig(file) {
  if (!fs.existsSync(file)) fail(`Config not found: ${file}`);
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(cfg.phases) || cfg.phases.length === 0)
    fail(`${file} lists no phases`);
  if (!cfg.featureBranch) fail(`${file} has no featureBranch`);
  return {
    active: cfg.active !== false,
    featureBranch: cfg.featureBranch,
    featureTitle: cfg.featureTitle || cfg.featureBranch,
    niceToHaveLabel: cfg.niceToHaveLabel || 'nice-to-have',
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

/**
 * Non-blocking review findings are filed under this label with no milestone, so they
 * stay in the backlog for a separate pass without ever blocking the current phase.
 */
function ensureNiceToHaveLabel(name) {
  const existing = ghTry('label', 'list', '--json', 'name').stdout;
  const names = JSON.parse(existing || '[]').map((l) => l.name);
  if (names.includes(name)) return;
  ghTry(
    'label',
    'create',
    name,
    '--description',
    'Non-blocking review finding, not scheduled into a phase',
    '--color',
    'C5DEF5',
  );
  log(`  created label "${name}" for non-blocking review findings`);
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
        log(`  ! no events for ${Math.round(idleSec)}s - session killed`);
        st.terminalReason = 'stalled';
        try {
          child.kill();
        } catch {
          /* already gone */
        }
      } else if (idleSec > stallSeconds && !stallWarned) {
        stallWarned = true;
        log(
          `  ! no events for ${Math.round(idleSec)}s, last was: ${st.lastTool || 'session start'}`,
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
              `  . ${st.turns} turns . ${fmtTokens(st.inputTokens)} in . ${fmtTokens(st.outputTokens)} out . ${st.lastTool || '...'}`,
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
    /* not critical */
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
      `rate limit hit (${info.rateLimitType}), stopping as configured`,
    );
  }
  const resetAt = (info.resetsAt || 0) * 1000;
  const waitMs = Math.max(0, resetAt - Date.now()) + 15000;
  log(
    `... ${info.rateLimitType} limit exhausted, waiting for reset at ${new Date(resetAt).toTimeString().slice(0, 8)} (${fmtDuration(waitMs)})`,
  );
  await sleep(waitMs);
}

function checkInterrupt() {
  if (stopRequested) throw new Stop('stopped by Ctrl-C');
  if (fs.existsSync(STOP_FILE)) throw new Stop(`found ${STOP_FILE}, stopping`);
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
      log(`  feature branch ${cfg.featureBranch} created from origin/${base}`);
      return;
    }
  } else {
    git('switch', cfg.featureBranch);
  }

  if (refExists(`refs/remotes/origin/${cfg.featureBranch}`)) {
    const pull = gitTry('merge', '--ff-only', `origin/${cfg.featureBranch}`);
    if (pull.code !== 0) {
      throw new Stop(
        `feature branch ${cfg.featureBranch} has diverged from origin, sort it out and re-run`,
      );
    }
  }

  if (isAncestor(`origin/${base}`, 'HEAD')) return;
  log(`  feature branch is behind origin/${base}, merging it in`);
  if (gitTry('merge', '--no-edit', `origin/${base}`).code !== 0) {
    gitTry('merge', '--abort');
    throw new Stop(
      `${cfg.featureBranch} conflicts with ${base}, resolve it manually and re-run`,
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
    log(`  branch ${phase.branch} created from ${cfg.featureBranch}`);
    return;
  }

  if (!refExists(`refs/heads/${phase.branch}`)) {
    git('switch', '-c', phase.branch, `origin/${phase.branch}`);
  } else {
    git('switch', phase.branch);
  }

  if (isAncestor(cfg.featureBranch, 'HEAD')) {
    log(`  branch ${phase.branch} reused`);
    return;
  }
  log(`  branch ${phase.branch} is behind ${cfg.featureBranch}, merging it in`);
  if (gitTry('merge', '--no-edit', cfg.featureBranch).code !== 0) {
    gitTry('merge', '--abort');
    throw new Stop(
      `${phase.branch} conflicts with ${cfg.featureBranch}, resolve it manually and re-run`,
    );
  }
}

/**
 * A phase counts as merged when its commits are already reachable from the trunk the
 * feature branch grows on. Before that branch exists the trunk is the default branch -
 * that is how phases merged under an earlier scheme (phase 1 went straight to master)
 * are recognised instead of being replayed.
 */
function phaseIsMerged(phase, cfg, base) {
  if (refExists(`refs/tags/${phaseTag(phase)}`)) return true;

  const local = refExists(`refs/heads/${phase.branch}`);
  const remote = refExists(`refs/remotes/origin/${phase.branch}`);
  if (!local && !remote) return true; // nothing to merge: the phase branch does not exist

  const trunk = refExists(`refs/heads/${cfg.featureBranch}`)
    ? cfg.featureBranch
    : `origin/${base}`;
  const tip = local ? phase.branch : `origin/${phase.branch}`;
  return isAncestor(tip, trunk);
}

// ─── green gate ────────────────────────────────────────────────────────────────

function runGreenGate() {
  for (const task of ['lint', 'test']) {
    log(`  running pnpm ${task}`);
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
      throw new Stop(`reached the --issues ${opts.issues} limit`);
    }
    if (budget.phaseTokens > budget.phaseLimit) {
      throw new Stop(
        `phase "${phase.milestone}" is over budget (${fmtTokens(budget.phaseTokens)} of ${fmtTokens(budget.phaseLimit)})`,
      );
    }

    const issue = open[0];
    const attempt = (attempts.get(issue.number) || 0) + 1;
    attempts.set(issue.number, attempt);

    log(
      `> issue #${issue.number} "${issue.title}" . attempt ${attempt}/${cfg.maxIssueAttempts} . ${cfg.implModel} . maxTurns ${cfg.maxTurns}`,
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
        `session hit a missing permission: ${JSON.stringify(st.denials).slice(0, 300)}\n` +
          '  add it to permissions.allow in .claude/settings.json and re-run',
      );
    }
    await handleRateLimit(st, cfg, opts);

    open = openIssues(phase.milestone);
    const closed = !open.some((i) => i.number === issue.number);
    const summary = `${st.turns} turns . ${fmtTokens(st.inputTokens)} in . ${fmtTokens(st.outputTokens)} out . ${fmtDuration(st.durationMs)} . ${st.terminalReason || 'no result event'} . run total ${fmtTokens(budget.runTokens)}`;

    if (closed) {
      budget.issuesClosed++;
      attempts.set(issue.number, 0);
      log(`+ issue #${issue.number} closed . ${summary}`);
      continue;
    }

    log(`- issue #${issue.number} still open . ${summary}`);
    if (issueTokens > cfg.issueBudgetTokens) {
      throw new Stop(
        `issue #${issue.number} is over budget (${fmtTokens(issueTokens)} of ${fmtTokens(cfg.issueBudgetTokens)}), it probably needs splitting`,
      );
    }
    if (attempt >= cfg.maxIssueAttempts) {
      throw new Stop(
        `issue #${issue.number} is not progressing after ${attempt} attempts, check ${STATS_FILE} and the issue comments`,
      );
    }
  }
}

async function reviewPhase(phase, cfg, opts, budget) {
  for (let round = 1; ; round++) {
    checkInterrupt();
    if (round > cfg.maxReviewRounds) {
      throw new Stop(
        `phase "${phase.milestone}" did not pass review in ${cfg.maxReviewRounds} rounds, branch ${phase.branch} is not merged`,
      );
    }
    log(
      `> phase review . round ${round}/${cfg.maxReviewRounds} . ${cfg.reviewModel}`,
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
        niceToHaveLabel: cfg.niceToHaveLabel,
      }),
    });
    recordStats('review', phase, null, st);
    budget.phaseTokens += st.inputTokens;
    budget.runTokens += st.inputTokens;
    budget.runCost += st.cost;

    if (st.denials.length > 0) {
      throw new Stop(
        `review hit a missing permission: ${JSON.stringify(st.denials).slice(0, 300)}`,
      );
    }
    await handleRateLimit(st, cfg, opts);

    const verdict = /(^|\n)\s*BLOCKED/i.test(st.resultText)
      ? 'BLOCKED'
      : 'APPROVED';
    log(
      `  review: ${verdict} . ${st.turns} turns . ${fmtTokens(st.inputTokens)} in . ${fmtDuration(st.durationMs)}`,
    );

    const stillOpen = openIssues(phase.milestone);
    if (stillOpen.length === 0) {
      // A verdict with no filed issue means the review found something blocking but
      // left no trace the loop could act on. Merging anyway would bury it.
      if (verdict === 'BLOCKED') {
        throw new Stop(
          `review returned BLOCKED but filed no issue, phase "${phase.milestone}" is not merged - see ${LOG_FILE}`,
        );
      }
      return;
    }

    log(
      `  review filed ${stillOpen.length} follow-up issue(s), back to implementation`,
    );
    await drainIssues(phase, cfg, opts, budget);
  }
}

async function runPhase(phase, cfg, opts, base, budget) {
  const openBefore = openIssues(phase.milestone);
  if (openBefore.length === 0 && phaseIsMerged(phase, cfg, base)) {
    log(
      `= phase "${phase.milestone}" already merged into ${cfg.featureBranch}, skipping`,
    );
    return false;
  }

  budget.phaseTokens = 0;
  budget.phaseLimit =
    cfg.issueBudgetTokens * Math.max(1, openBefore.length) +
    cfg.reviewBudgetTokens * cfg.maxReviewRounds;

  log(
    `> Phase ${phase.index} "${phase.milestone}" . branch ${phase.branch} . ${openBefore.length} open issue(s) . budget ${fmtTokens(budget.phaseLimit)}`,
  );

  prepareFeatureBranch(cfg, base);
  preparePhaseBranch(phase, cfg);

  await drainIssues(phase, cfg, opts, budget);
  await reviewPhase(phase, cfg, opts, budget);

  checkInterrupt();
  const failedTask = runGreenGate();
  if (failedTask) {
    throw new Stop(
      `pnpm ${failedTask} is red, branch ${phase.branch} is not merged - fix it and re-run`,
    );
  }

  // The phase goes into the feature branch as its own merge commit and gets a tag:
  // that pair is the rollback point for as long as the feature is not in the trunk.
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
      `merging ${phase.branch} into ${cfg.featureBranch} failed, resolve it manually and re-run`,
    );
  }
  git('tag', '-f', phaseTag(phase));
  git('push', '-u', 'origin', cfg.featureBranch);
  git('push', '-f', 'origin', phaseTag(phase));

  log(
    `+ phase ${phase.index} merged into ${cfg.featureBranch} . tag ${phaseTag(phase)} . ${fmtTokens(budget.phaseTokens)} for the phase`,
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
      `. feature not finished: ${unfinished.length} phase(s) left, no final pull request yet`,
    );
    return;
  }

  const existing = findPr(cfg.featureBranch, 'open');
  if (existing) {
    log(`. final pull request already open: ${existing.url}`);
    return;
  }

  const sections = allPhases.map((p) => {
    const rows = issuesOf(p.milestone, 'all')
      .map((i) => `| #${i.number} | ${i.title} |`)
      .join('\n');
    return [
      `### Phase ${p.index}: ${p.milestone}`,
      '',
      '| Issue | What |',
      '| --- | --- |',
      rows,
      '',
    ].join('\n');
  });

  const body = [
    `Implements **${cfg.featureTitle}** in full.`,
    '',
    'Every phase went into this branch as its own merge commit tagged `ralph/phase-N`,',
    `so phases can still be reverted one by one until this lands in \`${base}\`.`,
    '',
    '**Merge with a merge commit, not a squash** - a squash collapses the per-issue history.',
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
  log(`+ every phase is done, final pull request opened: ${url}`);
  log('  merging is yours to do - the orchestrator never writes to the trunk');
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
    `\nFeature branch: ${cfg.featureBranch} -> pull request into ${base} (you merge it)\n` +
      `Estimate: ${fmtTokens(perIssue)} per issue${baseline ? ' (baseline, no stats yet)' : ` (median from ${STATS_FILE})`}\n`,
  );

  for (const phase of phases) {
    const open = openIssues(phase.milestone);
    if (open.length === 0 && phaseIsMerged(phase, cfg, base)) {
      console.log(`  = ${phase.milestone} - already merged`);
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
      `  ${String(open.length).padStart(2)} issues  ~${fmtTokens(phaseTokens).padStart(6)} in  <= ${String(phaseSessions).padStart(2)} sessions   ${phase.milestone}`,
    );
  }

  console.log(
    `\nTotal: ${planned} phases, ${issues} issues, ~${fmtTokens(tokens)} input tokens, at most ${sessions} sessions`,
  );
  console.log('No session was started.\n');
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
  if (!found) fail(`Phase not found: ${opts.only}`);

  const skipped = all.filter(
    (p) => p.index < found.index && openIssues(p.milestone).length > 0,
  );
  if (skipped.length > 0) {
    log(
      `! --only skips unfinished phases: ${skipped.map((p) => '#' + p.index).join(', ')} - phases depend on each other, make sure this is deliberate`,
    );
  }
  if (opts.branch) found.branch = opts.branch;
  return [found];
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cfg = loadConfig(opts.config);

  if (fs.existsSync(STOP_FILE))
    fail(`Found ${STOP_FILE} - remove it to start the loop`);
  if (!cfg.active && !opts.dryRun)
    fail(`active: false in ${opts.config} - the loop is switched off`);
  if (!cfg.implPrompt || !cfg.reviewPrompt)
    fail(`${opts.config} has no implPrompt / reviewPrompt`);

  const base = gh(
    'repo',
    'view',
    '--json',
    'defaultBranchRef',
    '-q',
    '.defaultBranchRef.name',
  ).stdout;
  if (!base) fail('Could not resolve the default branch through gh');

  const allPhases = cfg.phases.map((p, i) => ({ ...p, index: i + 1 }));
  const phases = selectPhases(cfg, opts);

  if (opts.dryRun) {
    printPlan(phases, cfg, base);
    return;
  }

  const dirty = git('status', '--porcelain').stdout;
  if (dirty)
    fail(`Working tree is not clean - commit or stash first:\n${dirty}`);

  process.on('SIGINT', () => {
    if (stopRequested) {
      log('!! Ctrl-C again - killing the session now');
      if (currentChild) {
        try {
          currentChild.kill();
        } catch {
          /* already gone */
        }
      }
      process.exit(130);
    }
    stopRequested = true;
    log(
      '|| Ctrl-C - the current session finishes, no further issue is picked up (press again to kill now)',
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
    `> Ralph Loop . feature branch ${cfg.featureBranch} . trunk ${base} . models ${cfg.implModel}/${cfg.reviewModel} . maxTurns ${cfg.maxTurns}`,
  );
  ensureNiceToHaveLabel(cfg.niceToHaveLabel);

  try {
    for (const phase of phases) {
      if (opts.phases !== null && executed >= opts.phases) {
        log(`|| reached the --phases ${opts.phases} limit`);
        break;
      }
      checkInterrupt();
      if (await runPhase(phase, cfg, opts, base, budget)) executed++;
    }
    maybeOpenFeaturePr(cfg, allPhases, base);
    log(
      `= run finished . ${executed} phase(s) . ${budget.issuesClosed} issue(s) closed . ${fmtTokens(budget.runTokens)} in . $${budget.runCost.toFixed(2)} . ${fmtDuration(Date.now() - startedAt)}`,
    );
  } catch (err) {
    if (!(err instanceof Stop)) throw err;
    log(`!! STOPPED: ${err.message}`);
    log(
      `  run so far: ${executed} phase(s) . ${budget.issuesClosed} issue(s) . ${fmtTokens(budget.runTokens)} in . $${budget.runCost.toFixed(2)} . ${fmtDuration(Date.now() - startedAt)}`,
    );
    log(
      `  branch ${git('rev-parse', '--abbrev-ref', 'HEAD').stdout} left as is; re-running picks up from here`,
    );
    process.exitCode = 1;
  }
}

main().catch((err) => fail(err.stack || String(err)));
