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
let currentKill = null;

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

/**
 * Wraps a .cmd shim (claude, pnpm) for spawn. cmd.exe receives one command line, so
 * every argument is quoted here: config values such as implModel reach this point, and
 * an unquoted & in one of them would be read by the shell.
 */
function shimSpawnArgs(file, args) {
  if (!IS_WIN) return [file, args, {}];
  const safe = new RegExp('^[A-Za-z0-9_.:/@=-]+$');
  const quoted = args.map((a) => {
    const text = String(a);
    return safe.test(text) ? text : '"' + text.split('"').join('""') + '"';
  });
  return [
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', `"${file}" ${quoted.join(' ')}`],
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
  --only <n|name>    run exactly one phase: its phase number, or a substring of
                     its milestone title
  --issues N         stop after N closed issues, even mid-phase
  --branch <name>    override the phase branch; only together with --only
  --stop-on-limit    stop when the rate limit is hit instead of waiting for reset
  --config <path>    a config for a different feature (default ${CONFIG_DEFAULT})

Phases are discovered from GitHub milestones carrying a "Feature: <key>" line, ordered
by their "Phase N" title prefix. Each phase branch is derived as <featureBranch>-phase-N.

Phases accumulate on the feature branch, each as a merge commit with a tag - those tags
are the rollback points. Nothing is merged into the default branch: once every phase is
done the loop opens a single pull request and stops.

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
  if (!cfg.feature) fail(`${file} has no feature key`);
  if (!cfg.featureBranch) fail(`${file} has no featureBranch`);
  return {
    feature: cfg.feature,
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
    allowedTools: cfg.allowedTools || [
      'Bash',
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'Skill',
      'TodoWrite',
    ],
    onRateLimit: cfg.onRateLimit || 'wait',
    implPrompt: cfg.implPrompt,
    reviewPrompt: cfg.reviewPrompt,
  };
}

/**
 * Phases are read off GitHub rather than listed by hand: a milestone belongs to the
 * feature when its description carries a "Feature: <key>" line, and its position comes
 * from the "Phase N" prefix of its title. Titles alone are not enough - two features in
 * this repository both have a "Phase 1:".
 */
function discoverPhases(cfg) {
  const all = JSON.parse(
    gh('api', 'repos/:owner/:repo/milestones?state=all&per_page=100').stdout ||
      '[]',
  );
  const belongsToFeature = (description) =>
    String(description || '')
      .split('\n')
      .some((line) => line.trim() === `Feature: ${cfg.feature}`);
  const phases = [];

  for (const m of all) {
    if (!belongsToFeature(m.description)) continue;
    const numbered = new RegExp('^Phase\\s+(\\d+)\\s*:', 'i').exec(m.title);
    if (!numbered) {
      fail(
        `milestone "${m.title}" is marked as feature "${cfg.feature}" but its title does not start with "Phase N:"`,
      );
    }
    phases.push({
      index: Number(numbered[1]),
      milestone: m.title,
      branch: `${cfg.featureBranch}-phase-${numbered[1]}`,
    });
  }

  if (phases.length === 0) {
    fail(
      `no milestone carries "Feature: ${cfg.feature}" - create the backlog with the /issues skill, or fix the feature key in the config`,
    );
  }

  phases.sort((a, b) => a.index - b.index);
  const seen = new Set();
  for (const phase of phases) {
    if (seen.has(phase.index))
      fail(
        `two milestones both claim to be phase ${phase.index} of "${cfg.feature}"`,
      );
    seen.add(phase.index);
  }
  return phases;
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
  const existing = ghTry(
    'label',
    'list',
    '--limit',
    '200',
    '--json',
    'name',
  ).stdout;
  const names = JSON.parse(existing || '[]').map((l) => l.name);
  if (names.includes(name)) return;
  const created = ghTry(
    'label',
    'create',
    name,
    '--description',
    'Non-blocking review finding, not scheduled into a phase',
    '--color',
    'C5DEF5',
  );
  if (created.code === 0) {
    log(`  created label "${name}" for non-blocking review findings`);
  } else {
    log(
      `  ! could not create label "${name}": ${created.stderr.slice(0, 120)}`,
    );
  }
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
function runSession({ model, maxTurns, prompt, stallSeconds, allowedTools }) {
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
      // A session runs unattended, so a permission prompt simply kills it. The
      // allow-list in settings.json cannot cover this: Claude Code requires every
      // component of a compound command to be permitted, and no list anticipates the
      // shapes a session produces - the first live run died on `echo "---UPSTREAM---"`.
      '--allowedTools',
      ...allowedTools,
    ];
    const [file, spawnArgs, extra] = shimSpawnArgs('claude', args);
    const child = spawn(file, spawnArgs, {
      stdio: ['pipe', 'pipe', 'inherit'],
      ...extra,
    });
    child.stdout.setEncoding('utf8'); // a multi-byte character split across chunks
    currentChild = child; //             would otherwise corrupt a stream-json line

    let settled = false;
    let killed = false;
    // On Windows the child is a cmd.exe shim: killing it leaves the real claude
    // process running against the same working tree, so kill the tree.
    const killTree = () => {
      if (killed) return;
      killed = true;
      try {
        if (IS_WIN && child.pid) {
          spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
          });
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        /* already gone */
      }
    };
    currentKill = killTree;

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

    const finish = () => {
      if (settled) return;
      settled = true;
      clearInterval(watchdog);
      currentChild = null;
      currentKill = null;
      st.durationMs = Date.now() - started;
      resolve(st);
    };

    const watchdog = setInterval(() => {
      const idleSec = (Date.now() - lastEventAt) / 1000;
      if (idleSec > stallSeconds * 3) {
        if (!killed) {
          log(`  ! no events for ${Math.round(idleSec)}s - session killed`);
          st.terminalReason = 'stalled';
          st.exitCode = st.exitCode === undefined ? -1 : st.exitCode;
          killTree();
          // If close never arrives after the kill, give up on it rather than spin.
          setTimeout(finish, 15000);
        }
      } else if (idleSec > stallSeconds && !stallWarned) {
        stallWarned = true;
        log(
          `  ! no events for ${Math.round(idleSec)}s, last was: ${st.lastTool || 'session start'}`,
        );
      }
    }, 5000);

    // Without these listeners a spawn failure or an EPIPE on a dead child throws as
    // an uncaught exception and the promise never resolves.
    child.on('error', (err) => {
      log(`  ! could not run the session: ${err.message}`);
      st.terminalReason = 'spawn failed';
      st.exitCode = -1;
      finish();
    });
    child.stdin.on('error', () => {
      /* the child died before reading the prompt; close will report it */
    });

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
      if (st.exitCode === undefined || st.terminalReason !== 'stalled')
        st.exitCode = code;
      finish();
    });
  });
}

/**
 * Anything short of a clean completion must not be read as a verdict: an empty or
 * truncated reply would otherwise be indistinguishable from an approval.
 */
function sessionOutcome(st) {
  if (st.exitCode !== 0) return `exit code ${st.exitCode}`;
  if (st.isError) return 'the session reported an error';
  if (st.terminalReason && st.terminalReason !== 'completed')
    return st.terminalReason;
  if (!st.resultText.trim()) return 'no result event';
  return null;
}

/**
 * Fail-closed: only an explicit APPROVED approves. Reviewers decorate the token
 * (`**BLOCKED**`, `## BLOCKED`), so it is matched as a standalone word anywhere, and
 * the last one wins because the instruction is to end the reply with it.
 */
function readVerdict(text) {
  // Written as a literal on purpose: '\b' inside a quoted string is a backspace
  // character, not a word boundary, and that silently matched nothing at all.
  const tokens = String(text)
    .toUpperCase()
    .match(/\b(APPROVED|BLOCKED)\b/g);
  if (!tokens || tokens.length === 0) return 'an unreadable verdict';
  return tokens[tokens.length - 1];
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
  if (!info.resetsAt) {
    throw new Stop(
      `rate limit hit (${info.rateLimitType}) with no reset time reported - re-run once it clears`,
    );
  }
  const resetAt = info.resetsAt * 1000;
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

/** Scoped by feature branch: two features would otherwise share `ralph/phase-1`. */
const phaseTag = (phase, cfg) => {
  const scope = cfg.featureBranch.startsWith('feature/')
    ? cfg.featureBranch.slice('feature/'.length)
    : cfg.featureBranch;
  return `ralph/${scope}/phase-${phase.index}`;
};

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
  if (refExists(`refs/tags/${phaseTag(phase, cfg)}`)) return true;

  const local = refExists(`refs/heads/${phase.branch}`);
  const remote = refExists(`refs/remotes/origin/${phase.branch}`);
  // No branch is not evidence of completion - the phase may simply never have run.
  if (!local && !remote) return false;

  const trunk = refExists(`refs/heads/${cfg.featureBranch}`)
    ? cfg.featureBranch
    : refExists(`refs/remotes/origin/${cfg.featureBranch}`)
      ? `origin/${cfg.featureBranch}`
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
  const attempts = budget.attempts;
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
      allowedTools: cfg.allowedTools,
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

    const before = new Set(open.map((i) => i.number));
    open = openIssues(phase.milestone);
    const stillOpen = new Set(open.map((i) => i.number));
    budget.issuesClosed += [...before].filter((n) => !stillOpen.has(n)).length;
    const closed = !stillOpen.has(issue.number);
    const summary = `${st.turns} turns . ${fmtTokens(st.inputTokens)} in . ${fmtTokens(st.outputTokens)} out . ${fmtDuration(st.durationMs)} . ${st.terminalReason || 'no result event'} . run total ${fmtTokens(budget.runTokens)}`;

    if (closed) {
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
      allowedTools: cfg.allowedTools,
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

    const outcome = sessionOutcome(st);
    if (outcome) {
      throw new Stop(
        `the review session did not complete (${outcome}), phase "${phase.milestone}" is not merged`,
      );
    }

    const verdict = readVerdict(st.resultText);
    log(
      `  review: ${verdict} . ${st.turns} turns . ${fmtTokens(st.inputTokens)} in . ${fmtDuration(st.durationMs)}`,
    );

    const stillOpen = openIssues(phase.milestone);
    if (stillOpen.length === 0) {
      // Only an explicit APPROVED merges. A BLOCKED verdict with no filed issue, or a
      // reply no verdict could be read from, leaves nothing the loop could act on.
      if (verdict !== 'APPROVED') {
        throw new Stop(
          `review returned ${verdict} and filed no issue, phase "${phase.milestone}" is not merged - see ${LOG_FILE}`,
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
  if (issuesOf(phase.milestone, 'all').length === 0) {
    throw new Stop(
      `milestone "${phase.milestone}" has no issues - create the backlog first (the /issues skill)`,
    );
  }
  const openBefore = openIssues(phase.milestone);
  if (openBefore.length === 0 && phaseIsMerged(phase, cfg, base)) {
    log(
      `= phase "${phase.milestone}" already merged into ${cfg.featureBranch}, skipping`,
    );
    return false;
  }

  budget.attempts = new Map();
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
  const leftovers = git('status', '--porcelain').stdout;
  if (leftovers) {
    throw new Stop(
      `the working tree is not clean after phase "${phase.milestone}", refusing to merge:
${leftovers}`,
    );
  }
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
  git('tag', '-f', phaseTag(phase, cfg));
  git('push', '-u', 'origin', cfg.featureBranch);
  git('push', '-f', 'origin', phaseTag(phase, cfg));

  log(
    `+ phase ${phase.index} merged into ${cfg.featureBranch} . tag ${phaseTag(phase, cfg)} . ${fmtTokens(budget.phaseTokens)} for the phase`,
  );
  return true;
}

// ─── final pull request ────────────────────────────────────────────────────────

function maybeOpenFeaturePr(cfg, allPhases, base) {
  const unfinished = allPhases.filter(
    (p) =>
      issuesOf(p.milestone, 'all').length === 0 ||
      openIssues(p.milestone).length > 0 ||
      !phaseIsMerged(p, cfg, base),
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
    `\nFeature "${cfg.feature}" on ${cfg.featureBranch} -> pull request into ${base} (you merge it)\n` +
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

function selectPhases(all, opts) {
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

  const allPhases = discoverPhases(cfg);
  const phases = selectPhases(allPhases, opts);

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
      if (currentKill) currentKill();
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
    attempts: new Map(),
  };
  const startedAt = Date.now();
  let executed = 0;

  log(
    `> Ralph Loop . feature "${cfg.feature}" . branch ${cfg.featureBranch} . trunk ${base} . models ${cfg.implModel}/${cfg.reviewModel} . maxTurns ${cfg.maxTurns}`,
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
