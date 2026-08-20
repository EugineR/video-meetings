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
const IS_WIN = process.platform === 'win32';

/**
 * Where the run's own state lives. Mutable so a test can point the whole lot at a
 * temporary directory: a suite that appended to the real ralph.stats.jsonl would
 * corrupt the very baseline the loop is measured against.
 */
const paths = {
  log: '.claude/ralph.log',
  stats: '.claude/ralph.stats.jsonl',
  stop: '.claude/ralph.stop',
};

// Baseline from docs/ralph-loop-rework/plan.md §3, used until ralph.stats.jsonl has samples.
const BASELINE_ISSUE_TOKENS = 1_800_000;
const BASELINE_REVIEW_TOKENS = 4_000_000;

let stopRequested = false;
let currentChild = null;
let currentKill = null;

class Stop extends Error {}

/**
 * The only door to the outside world. Tests swap these for fakes and drive the whole
 * orchestrator without a real claude, git, gh or pnpm; production never touches the
 * fields. Keeping it one object means a test cannot forget to stub one of the two.
 */
const runtime = { spawn, spawnSync };

// ─── infrastructure ────────────────────────────────────────────────────────────

function fail(message) {
  console.error(`x ${message}`);
  process.exit(1);
}

function log(line) {
  const text = `[${new Date().toTimeString().slice(0, 8)}] ${line}`;
  console.log(text);
  try {
    fs.appendFileSync(paths.log, text + '\n');
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
  const r = runtime.spawnSync(file, args, {
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

To stop: Ctrl-C (graceful), Ctrl-C twice (immediate), or create ${paths.stop}.
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
    maxRateLimitRetries: cfg.maxRateLimitRetries || 3,
    issueBudgetTokens: cfg.issueBudgetTokens || 6_000_000,
    reviewBudgetTokens: cfg.reviewBudgetTokens || 4_000_000,
    // Effort is explicit per stage rather than inherited.
    implEffort: cfg.implEffort || 'medium',
    reviewEffort: cfg.reviewEffort || 'high',
    // Runaway detectors, not throttles: the dearest healthy session on record cost
    // $4.42, so these sit well above it and only catch a session that has lost its way.
    implMaxCostUsd: cfg.implMaxCostUsd || 6,
    phaseReviewMaxCostUsd: cfg.phaseReviewMaxCostUsd || 4,
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

function newSessionStats() {
  return {
    // Raw stream observations. `messages` is keyed by message id because a message is
    // re-emitted as it grows and each emission repeats that message's running usage:
    // adding them up counts the same tokens several times over, which is how a session
    // came to report 15.6M input and 156 "turns" under a 100-turn cap.
    assistantEvents: 0,
    messages: new Map(),
    anonymousUsage: [],
    resultUsage: null,
    resultTurns: null,

    // Filled by finalizeUsage once the stream ends.
    apiRequests: 0,
    inputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    grossInputTokens: 0,
    outputTokens: 0,
    forkedEvents: 0,
    usageQuality: 'estimated',

    cost: 0,
    terminalReason: null,
    denials: [],
    rateLimit: null,
    resultText: '',
    isError: false,
    lastTool: null,
  };
}

/** Every usage record seen, one per distinct message rather than per event. */
function distinctUsage(st) {
  return [...st.messages.values(), ...st.anonymousUsage];
}

/** Gross input across distinct messages - the live progress line's only honest number. */
function currentGrossInput(st) {
  return distinctUsage(st).reduce(
    (n, u) => n + u.input + u.cacheCreate + u.cacheRead,
    0,
  );
}

/**
 * Settles the token counts once the stream has ended.
 *
 * The aggregate on the final `result` event is the API's own accounting and wins
 * whenever it is there. De-duplicating by message id is the fallback for a session cut
 * off before its result event; if there is nothing at all, the counts stay zero and say
 * so rather than pretending to a number. Cost is not computed here - `total_cost_usd`
 * is reported directly by the CLI and was always correct.
 */
function finalizeUsage(st) {
  const seen = distinctUsage(st);

  if (st.resultUsage) {
    const u = st.resultUsage;
    st.inputTokens = u.input_tokens || 0;
    st.cacheCreationInputTokens = u.cache_creation_input_tokens || 0;
    st.cacheReadInputTokens = u.cache_read_input_tokens || 0;
    st.outputTokens = u.output_tokens || 0;
    st.usageQuality = 'result';
  } else if (seen.length > 0) {
    const sum = (key) => seen.reduce((n, u) => n + u[key], 0);
    st.inputTokens = sum('input');
    st.cacheCreationInputTokens = sum('cacheCreate');
    st.cacheReadInputTokens = sum('cacheRead');
    st.outputTokens = sum('output');
    st.usageQuality = 'deduplicated';
  } else {
    st.usageQuality = 'estimated';
  }

  st.grossInputTokens =
    st.inputTokens + st.cacheCreationInputTokens + st.cacheReadInputTokens;
  st.apiRequests =
    st.resultTurns === null ? st.messages.size + st.anonymousUsage.length : st.resultTurns;
  st.forkedEvents = seen.filter((u) => u.fork).length;
  return st;
}

/** A stream-json line, or null for a blank or malformed one - never a throw. */
function parseStreamLine(line) {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/**
 * Folds one stream-json event into the session stats. Split out from runSession so the
 * accounting can be driven by a recorded stream in a test: runSession owns the
 * transport, this owns the arithmetic, and neither needs the other to be exercised.
 */
function applyStreamEvent(st, ev) {
  if (!ev || typeof ev !== 'object') return;

  if (ev.type === 'rate_limit_event' && ev.rate_limit_info) {
    st.rateLimit = ev.rate_limit_info;
  }
  if (ev.type === 'assistant' && ev.message) {
    st.assistantEvents++;
    const u = ev.message.usage || {};
    const usage = {
      input: u.input_tokens || 0,
      cacheCreate: u.cache_creation_input_tokens || 0,
      cacheRead: u.cache_read_input_tokens || 0,
      output: u.output_tokens || 0,
      // A subagent's events carry the tool call that spawned it; keeping the flag lets
      // a run show how much of its spend went to forks rather than to the session.
      fork: !!ev.parent_tool_use_id,
    };
    // Last emission of a message supersedes the earlier ones - its usage is that
    // message's running total, not the increment since the previous event.
    if (ev.message.id) st.messages.set(ev.message.id, usage);
    else st.anonymousUsage.push(usage);

    for (const part of ev.message.content || []) {
      if (part.type === 'tool_use') st.lastTool = describeTool(part);
    }
  }
  if (ev.type === 'result') {
    st.terminalReason = st.terminalReason || ev.terminal_reason || null;
    st.denials = ev.permission_denials || [];
    st.cost = ev.total_cost_usd || 0;
    st.isError = !!ev.is_error;
    st.resultText = typeof ev.result === 'string' ? ev.result : '';
    if (ev.usage && typeof ev.usage === 'object') st.resultUsage = ev.usage;
    if (Number.isFinite(ev.num_turns)) st.resultTurns = ev.num_turns;
  }
}

/**
 * Runs one `claude -p` session. The prompt goes through stdin, so no shell escaping
 * is involved and the hook-payload leak of the old Stop hook cannot recur.
 */
function runSession({
  model,
  maxTurns,
  prompt,
  stallSeconds,
  allowedTools,
  effort,
  maxCostUsd,
}) {
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
      // Moves cwd, env info and git status out of the system prompt. A loop spawns
      // dozens of sessions against the same repository, so keeping the cached prefix
      // identical between them is free.
      '--exclude-dynamic-system-prompt-sections',
    ];

    // Effort was previously whatever a session inherited; a reviewer that quietly
    // thought less than intended is not a reviewer anyone can rely on.
    if (effort) args.push('--effort', effort);

    // The only limit that bites while the session is still running. Everything else -
    // the token budget, the attempt counter - is checked once the session is already
    // over and the money already spent.
    if (maxCostUsd) args.push('--max-budget-usd', String(maxCostUsd));

    // Must stay last: --allowedTools is variadic, so any flag after it would be
    // swallowed as another tool name.
    //
    // A session runs unattended, so a permission prompt simply kills it. The
    // allow-list in settings.json cannot cover this: Claude Code requires every
    // component of a compound command to be permitted, and no list anticipates the
    // shapes a session produces - the first live run died on `echo "---UPSTREAM---"`.
    args.push('--allowedTools', ...allowedTools);
    const [file, spawnArgs, extra] = shimSpawnArgs('claude', args);
    const child = runtime.spawn(file, spawnArgs, {
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
    const st = newSessionStats();

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
      finalizeUsage(st);
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
        const ev = parseStreamLine(line);
        if (!ev) continue;
        applyStreamEvent(st, ev);

        if (
          ev.type === 'assistant' &&
          ev.message &&
          Date.now() - lastPrintAt > 20000
        ) {
          lastPrintAt = Date.now();
          // "events", not "turns": this counts stream emissions, which is not what
          // --max-turns limits. The cost is only known from the result event.
          log(
            `  . ${st.assistantEvents} events . ${fmtTokens(currentGrossInput(st))} gross in . ${st.lastTool || '...'}`,
          );
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
/**
 * True when the rate limit, not the task, ended the session. handleRateLimit has
 * already waited for the reset by the time this is consulted.
 */
const deniedTools = (st) =>
  [...new Set(st.denials.map((d) => d.tool_name))].join(', ');

/**
 * A denial only matters when the session could not carry on without the tool. Sessions
 * routinely reach for an alternative - the phase 2 review was refused PowerShell, ran
 * the same command through Bash and finished its work - and killing those throws away a
 * healthy session. An incomplete session is caught by sessionOutcome; one that gave up
 * without closing its issue is caught by the attempt counter.
 */
function reportDenials(st, what) {
  if (st.denials.length === 0) return;
  log(
    `  ! ${what} was denied ${deniedTools(st)} and worked around it - add it to allowedTools if this repeats`,
  );
}

function abortedByRateLimit(st) {
  const info = st.rateLimit;
  if (!info || info.status === 'allowed') return false;
  return st.terminalReason !== 'completed';
}

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

const STATS_SCHEMA_VERSION = 2;

/**
 * A v2 stats row. `inputTokens` now means what the API means by it - the all-three sum
 * that used to live under that name is `grossInputTokens`, so a v1 row and a v2 row
 * must never be averaged together without normalising first (see readStatsRows).
 */
function buildStatsRow(kind, phase, issueNumber, st, meta = {}) {
  return {
    schemaVersion: STATS_SCHEMA_VERSION,
    at: new Date().toISOString(),
    kind,
    phase: phase.milestone,
    issue: issueNumber,
    stage: meta.stage || null,
    model: meta.model || null,
    effort: meta.effort || null,
    terminalReason: st.terminalReason,
    assistantEvents: st.assistantEvents,
    apiRequests: st.apiRequests,
    inputTokens: st.inputTokens,
    cacheCreationInputTokens: st.cacheCreationInputTokens,
    cacheReadInputTokens: st.cacheReadInputTokens,
    grossInputTokens: st.grossInputTokens,
    outputTokens: st.outputTokens,
    forkedEvents: st.forkedEvents,
    costUsd: st.cost,
    usageQuality: st.usageQuality,
    durationMs: st.durationMs,
    exitCode: st.exitCode,
    rateLimitType: st.rateLimit ? st.rateLimit.rateLimitType || null : null,
    rateLimitResetsAt: st.rateLimit ? st.rateLimit.resetsAt || null : null,
  };
}

/**
 * Reads the stats file, normalising v1 rows instead of dropping them.
 *
 * A v1 row's `inputTokens` was the gross sum, so it is carried over as
 * `grossInputTokens` and its own `inputTokens` is cleared: leaving it in place would
 * make a legacy row look like an enormous non-cached input. Its usage is marked
 * `estimated` because the underlying number double-counted re-emitted messages.
 */
function readStatsRows(file = paths.stats) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .map((row) => {
      if (row.schemaVersion >= 2) return row;
      return {
        ...row,
        schemaVersion: 1,
        kind: row.kind === 'review' ? 'phase-review' : row.kind,
        apiRequests: null,
        assistantEvents: row.turns || 0,
        inputTokens: null,
        cacheCreationInputTokens: null,
        cacheReadInputTokens: null,
        grossInputTokens: row.inputTokens || 0,
        usageQuality: 'estimated',
      };
    });
}

function recordStats(kind, phase, issueNumber, st, meta) {
  const row = buildStatsRow(kind, phase, issueNumber, st, meta);
  try {
    fs.appendFileSync(paths.stats, JSON.stringify(row) + '\n');
  } catch {
    /* not critical */
  }
}

/**
 * Median gross input of past implementation sessions, or the §3 baseline.
 *
 * Gross is the one quantity a v1 and a v2 row both express, so it is what the estimate
 * is built from while the file holds a mix of the two.
 */
function estimateIssueTokens() {
  const samples = readStatsRows()
    .filter((r) => r.kind === 'impl' && r.grossInputTokens > 0)
    .map((r) => r.grossInputTokens)
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
  if (fs.existsSync(paths.stop)) throw new Stop(`found ${paths.stop}, stopping`);
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
    const r = runtime.spawnSync(file, args, {
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
      effort: cfg.implEffort,
      maxCostUsd: cfg.implMaxCostUsd,
      prompt: fillPrompt(cfg.implPrompt, {
        milestone: phase.milestone,
        branch: phase.branch,
        issue: issue.number,
        title: issue.title,
      }),
    });
    recordStats('impl', phase, issue.number, st, {
      stage: 'IMPLEMENT',
      model: cfg.implModel,
      effort: cfg.implEffort,
    });
    budget.phaseTokens += st.grossInputTokens;
    budget.runTokens += st.grossInputTokens;
    budget.runCost += st.cost;

    const issueTokens =
      (budget.perIssue.get(issue.number) || 0) + st.grossInputTokens;
    budget.perIssue.set(issue.number, issueTokens);

    const outcome = sessionOutcome(st);
    if (st.denials.length > 0 && outcome && !abortedByRateLimit(st)) {
      throw new Stop(
        `session was denied ${deniedTools(st)} and did not complete (${outcome}) - add it to allowedTools in ${CONFIG_DEFAULT} and re-run`,
      );
    }
    reportDenials(st, 'session');
    await handleRateLimit(st, cfg, opts);

    const before = new Set(open.map((i) => i.number));
    open = openIssues(phase.milestone);
    const stillOpen = new Set(open.map((i) => i.number));
    budget.issuesClosed += [...before].filter((n) => !stillOpen.has(n)).length;
    const closed = !stillOpen.has(issue.number);
    const summary = `$${st.cost.toFixed(2)} . ${fmtDuration(st.durationMs)} . ${st.apiRequests} req . ${fmtTokens(st.grossInputTokens)} gross in . ${st.terminalReason || 'no result event'} . run total $${budget.runCost.toFixed(2)}`;

    // The budget applies however the session ended. It used to be checked only after
    // the closed and rate-limited branches had already continued, which is how issue
    // #40 ran to 15.6M against a 6M cap without a word: it closed, so nothing measured
    // it. An issue that only just made it is exactly the signal that the next one
    // will not.
    const budgetStop = () =>
      new Stop(
        `issue #${issue.number} used ${fmtTokens(issueTokens)} of its ${fmtTokens(cfg.issueBudgetTokens)} budget, it probably needs splitting`,
      );
    const overBudget = issueTokens > cfg.issueBudgetTokens;

    if (closed) {
      attempts.set(issue.number, 0);
      log(`+ issue #${issue.number} closed . ${summary}`);
      if (overBudget) throw budgetStop();
      continue;
    }

    // A session the rate limit cut off did not fail at the task, it never got to
    // finish it. Charging it an attempt means a limit arriving twice looks exactly
    // like an issue that cannot be implemented.
    if (abortedByRateLimit(st)) {
      const aborts = (budget.limitAborts.get(issue.number) || 0) + 1;
      budget.limitAborts.set(issue.number, aborts);
      if (aborts > cfg.maxRateLimitRetries) {
        throw new Stop(
          `issue #${issue.number} was cut off by the rate limit ${aborts} times, stopping instead of retrying further`,
        );
      }
      attempts.set(issue.number, attempt - 1);
      log(
        `~ issue #${issue.number} cut off by the rate limit, retrying without charging an attempt (${aborts}/${cfg.maxRateLimitRetries}) . ${summary}`,
      );
      if (overBudget) throw budgetStop();
      continue;
    }

    log(`- issue #${issue.number} still open . ${summary}`);
    if (overBudget) throw budgetStop();
    if (attempt >= cfg.maxIssueAttempts) {
      throw new Stop(
        `issue #${issue.number} is not progressing after ${attempt} attempts, check ${paths.stats} and the issue comments`,
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
      effort: cfg.reviewEffort,
      maxCostUsd: cfg.phaseReviewMaxCostUsd,
      prompt: fillPrompt(cfg.reviewPrompt, {
        milestone: phase.milestone,
        branch: phase.branch,
        featureBranch: cfg.featureBranch,
        range: `${cfg.featureBranch}...${phase.branch}`,
        niceToHaveLabel: cfg.niceToHaveLabel,
      }),
    });
    recordStats('phase-review', phase, null, st, {
      stage: 'PHASE_REVIEW',
      model: cfg.reviewModel,
      effort: cfg.reviewEffort,
    });
    budget.phaseTokens += st.grossInputTokens;
    budget.runTokens += st.grossInputTokens;
    budget.runCost += st.cost;

    reportDenials(st, 'review');
    await handleRateLimit(st, cfg, opts);

    const outcome = sessionOutcome(st);
    if (outcome) {
      throw new Stop(
        `the review session did not complete (${outcome}), phase "${phase.milestone}" is not merged`,
      );
    }

    const verdict = readVerdict(st.resultText);
    log(
      `  review: ${verdict} . $${st.cost.toFixed(2)} . ${st.apiRequests} req . ${fmtDuration(st.durationMs)}`,
    );

    const stillOpen = openIssues(phase.milestone);
    if (stillOpen.length === 0) {
      // Only an explicit APPROVED merges. A BLOCKED verdict with no filed issue, or a
      // reply no verdict could be read from, leaves nothing the loop could act on.
      if (verdict !== 'APPROVED') {
        throw new Stop(
          `review returned ${verdict} and filed no issue, phase "${phase.milestone}" is not merged - see ${paths.log}`,
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
  budget.limitAborts = new Map();
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
      `Estimate: ${fmtTokens(perIssue)} per issue${baseline ? ' (baseline, no stats yet)' : ` (median from ${paths.stats})`}\n`,
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

  if (fs.existsSync(paths.stop))
    fail(`Found ${paths.stop} - remove it to start the loop`);
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

  // The orchestrator lives in .claude/, which is versioned per branch, and a finished
  // run leaves the tree on a phase branch. Starting from there would silently execute
  // that branch's older copy of this file and its config.
  const current = git('rev-parse', '--abbrev-ref', 'HEAD').stdout;
  if (current !== base) {
    fail(
      `Start the loop from ${base}, not ${current}. A previous run leaves the tree on its phase branch, and running from there would use that branch's copy of the orchestrator.`,
    );
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
    limitAborts: new Map(),
  };
  const startedAt = Date.now();
  let executed = 0;

  log(
    `> Ralph Loop . feature "${cfg.feature}" . branch ${cfg.featureBranch} . trunk ${base} . models ${cfg.implModel}/${cfg.reviewModel} . effort ${cfg.implEffort}/${cfg.reviewEffort} . cost cap $${cfg.implMaxCostUsd}/$${cfg.phaseReviewMaxCostUsd} per session`,
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

// ─── entry point ───────────────────────────────────────────────────────────────

/**
 * Only the CLI runs the loop. Requiring this file must stay inert: the tests import it
 * to exercise the accounting and the state rules, and an import that parsed argv or
 * reached for GitHub would make that impossible.
 */
if (require.main === module) {
  main().catch((err) => fail(err.stack || String(err)));
}

module.exports = {
  runtime,
  paths,
  parseArgs,
  loadConfig,
  fillPrompt,
  describeTool,
  newSessionStats,
  parseStreamLine,
  applyStreamEvent,
  finalizeUsage,
  currentGrossInput,
  readStatsRows,
  runSession,
  drainIssues,
  recordStats,
  readVerdict,
  sessionOutcome,
  abortedByRateLimit,
  deniedTools,
  buildStatsRow,
  estimateIssueTokens,
  phaseTag,
  shimSpawnArgs,
  fmtTokens,
  fmtDuration,
  main,
};
