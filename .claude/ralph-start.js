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
  state: '.claude/ralph.state.json',
};

// Baseline from docs/ralph-loop-rework/plan.md §3, used until ralph.stats.jsonl has samples.
const BASELINE_ISSUE_TOKENS = 1_800_000;
const BASELINE_REVIEW_TOKENS = 4_000_000;

// Measured over issues #31-#40, see docs/ralph-loop-cost/research.md §1. Cost is the
// only figure the old telemetry got right, so these are real numbers rather than guesses.
const BASELINE_ISSUE_COST_USD = 2.02;
const BASELINE_REVIEW_COST_USD = 1.23;

// Everything an issue is charged to. A per-issue figure that counted implementation
// alone would understate what the loop actually spends on one issue.
const ISSUE_KINDS = ['impl', 'issue-review', 'repair'];

/**
 * The per-issue gate, run by the orchestrator between implementation and review.
 *
 * `when` is a path prefix - the step runs only when the change touches that workspace.
 * `files` appends the changed files to the command. Every step here was run against
 * this repository before it was made a default; e2e is deliberately not among them,
 * because it needs the Postgres container and a step that fails when Docker is down
 * would block every issue. Add it to `issueGate` in the config once the container is
 * part of the run: { "name": "e2e", "run": ["pnpm","--filter","api","run","test:e2e"],
 * "when": "apps/api/" }.
 */
const DEFAULT_ISSUE_GATE = [
  { name: 'format', run: ['pnpm', 'exec', 'prettier', '--write'], files: true },
  { name: 'lint:api', run: ['pnpm', 'lint:api'], when: 'apps/api/' },
  { name: 'lint:web', run: ['pnpm', 'lint:web'], when: 'apps/web/' },
  {
    name: 'typecheck:api',
    run: ['pnpm', '--filter', 'api', 'exec', 'tsc', '--noEmit'],
    when: 'apps/api/',
  },
  {
    name: 'typecheck:web',
    run: ['pnpm', '--filter', 'web', 'exec', 'tsc', '--noEmit'],
    when: 'apps/web/',
  },
  { name: 'test:api', run: ['pnpm', 'test:api'], when: 'apps/api/' },
];

let stopRequested = false;
let currentChild = null;
let currentKill = null;

class Stop extends Error {}

/**
 * The only door to the outside world. Tests swap these for fakes and drive the whole
 * orchestrator without a real claude, git, gh or pnpm; production never touches the
 * fields. Keeping it one object means a test cannot forget to stub one of the two.
 */
const runtime = { spawn, spawnSync, sleep };

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

Every stage is checkpointed to ${paths.state}, so a stop - a rate limit, a Ctrl-C, a
crash - resumes that stage rather than repeating the issue. The checkpoint is cleared
only once GitHub confirms the issue closed. Delete it to start the current issue over.
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
  // A missing prompt used to reach the CLI as the string "undefined".
  for (const key of ['implPrompt', 'issueReviewPrompt', 'repairPrompt', 'reviewPrompt']) {
    if (!cfg[key]) fail(`${file} has no ${key}`);
  }

  const out = {
    feature: cfg.feature,
    featureBranch: cfg.featureBranch,
    featureTitle: cfg.featureTitle || cfg.featureBranch,
    niceToHaveLabel: cfg.niceToHaveLabel || 'nice-to-have',
    implModel: cfg.implModel || 'sonnet',
    reviewModel: cfg.reviewModel || 'opus',
    // The issue reviewer is a stage that did not exist before, so naming its model and
    // effort sets a baseline rather than changing one - which is why it carries an
    // explicit effort while implEffort and reviewEffort stay inherited. A reviewer is
    // also the last place worth saving on: one that thinks less finds less.
    issueReviewModel: cfg.issueReviewModel || 'sonnet',
    issueReviewEffort: cfg.issueReviewEffort || 'high',
    maxTurns: cfg.maxTurns || 100,
    maxIssueAttempts: cfg.maxIssueAttempts || 2,
    maxIssueRepairs: cfg.maxIssueRepairs || 2,
    maxReviewRounds: cfg.maxReviewRounds || 3,
    maxRateLimitRetries: cfg.maxRateLimitRetries || 3,
    // How many resets one run may sit through. Waiting does not cost an attempt, so
    // without a cap a run can spend a day asleep and report nothing back.
    maxRateLimitWaits: cfg.maxRateLimitWaits || 4,
    issueBudgetTokens: cfg.issueBudgetTokens || 6_000_000,
    reviewBudgetTokens: cfg.reviewBudgetTokens || 4_000_000,
    // Opt-in, and deliberately not defaulted. Effort has never been set for this
    // repository, so every session so far ran at the CLI's own default - which the
    // CLI does not document. Picking a value here would silently change both the cost
    // and the quality of every session against an unknown baseline. The plumbing is
    // ready; choose a level once there is v2 telemetry to compare against.
    implEffort: cfg.implEffort || null,
    reviewEffort: cfg.reviewEffort || null,
    // Runaway detectors, not throttles: the dearest healthy session on record cost
    // $4.42, so these sit well above it and only catch a session that has lost its way.
    implMaxCostUsd: cfg.implMaxCostUsd || 6,
    issueReviewMaxCostUsd: cfg.issueReviewMaxCostUsd || 2,
    repairMaxCostUsd: cfg.repairMaxCostUsd || 3,
    phaseReviewMaxCostUsd: cfg.phaseReviewMaxCostUsd || 4,
    stallSeconds: cfg.stallSeconds || 120,
    issueBodyChars: cfg.issueBodyChars || 6000,
    issueDiffWarnLines: cfg.issueDiffWarnLines || 1200,
    // Permission to run unattended. `Skill` is deliberately absent: the skills a
    // session used to reach for forked a subagent, and the one it was told to run
    // reviewed its own work.
    allowedTools: cfg.allowedTools || [
      'Bash',
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'TodoWrite',
    ],
    // Availability, which is a different thing: --tools decides what the session can
    // see at all. An implementation session has no reason to fork, and a reviewer must
    // not be able to write.
    implTools: cfg.implTools || [
      'Bash',
      'PowerShell',
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'TodoWrite',
    ],
    implDisallowedTools: cfg.implDisallowedTools || ['Task', 'Skill'],
    issueReviewTools: cfg.issueReviewTools || ['Read', 'Grep', 'Glob', 'Bash'],
    issueReviewDisallowedTools: cfg.issueReviewDisallowedTools || [
      'Task',
      'Skill',
      'Edit',
      'Write',
      'NotebookEdit',
      'WebSearch',
      'WebFetch',
    ],
    // A browser is handed only to an issue that is about the browser. Anything that
    // can drive Playwright eventually does.
    browserTools: cfg.browserTools || ['mcp__playwright'],
    browserIssueLabels: cfg.browserIssueLabels || ['web', 'frontend', 'ui', 'e2e'],
    issueGate: cfg.issueGate || DEFAULT_ISSUE_GATE,
    // `stop` is the default a config that says nothing gets: stopping is only cheap
    // because the checkpoint resumes the exact stage, so an orchestrator without a
    // checkpoint should never have defaulted to sleeping through a reset. A config may
    // still ask for `wait` - .claude/ralph.config.json does, for unattended runs.
    onRateLimit: cfg.onRateLimit || 'stop',
    implPrompt: cfg.implPrompt,
    issueReviewPrompt: cfg.issueReviewPrompt,
    repairPrompt: cfg.repairPrompt,
    reviewPrompt: cfg.reviewPrompt,
  };

  // A tool a session can see but may not run is how a session stalls: it asks for
  // permission nobody is there to give. The other way round is harmless.
  const permitted = (tool) =>
    out.allowedTools.some((a) => a === tool || a.startsWith(`${tool}(`));
  for (const [name, list] of [
    ['implTools', out.implTools],
    ['issueReviewTools', out.issueReviewTools],
  ]) {
    const orphans = list.filter((t) => !permitted(t));
    if (orphans.length > 0) {
      console.log(
        `! ${name} offers ${orphans.join(', ')} but allowedTools does not permit it - a session asking for it will stall`,
      );
    }
  }
  return out;
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
  tools,
  disallowedTools,
  disableSlashCommands,
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

    // --tools decides which built-in tools exist at all; --allowedTools only grants
    // permission for tools the session can already see. Only the first can keep a
    // reviewer read-only or stop an implementation session forking a subagent. Both
    // are variadic, so each value is joined with commas into a single argument.
    if (tools && tools.length > 0) args.push('--tools', tools.join(','));
    if (disallowedTools && disallowedTools.length > 0) {
      args.push('--disallowedTools', disallowedTools.join(','));
    }
    // Skills are the other door to a subagent: /code-review forked one per issue and
    // it was the single most expensive thing in a session.
    if (disableSlashCommands) args.push('--disable-slash-commands');

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
  const byIssue = new Map();
  for (const r of readStatsRows()) {
    if (!ISSUE_KINDS.includes(r.kind) || !(r.grossInputTokens > 0)) continue;
    const key = r.issue === null || r.issue === undefined ? r.at : r.issue;
    byIssue.set(key, (byIssue.get(key) || 0) + r.grossInputTokens);
  }
  const samples = [...byIssue.values()].sort((a, b) => a - b);
  if (samples.length < 3) return BASELINE_ISSUE_TOKENS;
  return samples[Math.floor(samples.length / 2)];
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Median dollar cost of past work of one kind.
 *
 * costUsd is the one quantity a v1 and a v2 row both state correctly - it always came
 * straight from the CLI's own total_cost_usd - so unlike the token counts the whole
 * file can be used. Three samples is the point at which a median beats the baseline.
 *
 * `perIssue` groups the sessions of one issue together first. Four of the ten issues on
 * record took two sessions, so a median over rows answers "what does a session cost"
 * when the question the plan is asking is "what does an issue cost" - $1.71 against the
 * $2.02 actually spent.
 */
function estimateCost(kind, fallbackUsd, { perIssue = false } = {}) {
  const kinds = Array.isArray(kind) ? kind : [kind];
  const rows = readStatsRows().filter(
    (r) => kinds.includes(r.kind) && r.costUsd > 0,
  );

  let samples;
  if (perIssue) {
    const byIssue = new Map();
    for (const r of rows) {
      const key = r.issue === null || r.issue === undefined ? r.at : r.issue;
      byIssue.set(key, (byIssue.get(key) || 0) + r.costUsd);
    }
    samples = [...byIssue.values()];
  } else {
    samples = rows.map((r) => r.costUsd);
  }

  const mid = samples.length >= 3 ? median(samples) : null;
  return {
    usd: mid === null ? fallbackUsd : mid,
    samples: samples.length,
    sessions: rows.length,
    fromBaseline: mid === null,
    legacyOnly: rows.length > 0 && rows.every((r) => r.schemaVersion === 1),
  };
}

/**
 * One pass, so a substituted value is never scanned again. Prompts now carry issue
 * bodies written by whoever filed the issue: with successive replacements a body
 * containing "{branch}" would have been filled in as if the template had asked for it.
 * An unknown placeholder is left as written rather than blanked.
 */
function fillPrompt(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}

// ─── rate limit ────────────────────────────────────────────────────────────────

async function handleRateLimit(st, cfg, opts, budget) {
  const info = st.rateLimit;
  if (!info || info.status === 'allowed') return;
  if (opts.stopOnLimit || cfg.onRateLimit === 'stop') {
    throw new Stop(
      `rate limit hit (${info.rateLimitType}), stopping as configured - re-run once it clears and the checkpoint picks the current stage back up`,
    );
  }
  if (!info.resetsAt) {
    throw new Stop(
      `rate limit hit (${info.rateLimitType}) with no reset time reported - re-run once it clears`,
    );
  }
  // Waiting is not an attempt, but it is not free either: a run that keeps waiting out
  // resets can burn a whole day making no progress, so the waits are counted and capped.
  if (budget) {
    budget.rateLimitWaits = (budget.rateLimitWaits || 0) + 1;
    if (budget.rateLimitWaits > cfg.maxRateLimitWaits) {
      throw new Stop(
        `this run has already waited out ${cfg.maxRateLimitWaits} rate-limit reset(s), stopping instead of waiting again - re-run later and the checkpoint picks the current stage back up`,
      );
    }
  }
  const resetAt = info.resetsAt * 1000;
  const waitMs = Math.max(0, resetAt - Date.now()) + 15000;
  log(
    `... ${info.rateLimitType} limit exhausted, waiting for reset at ${new Date(resetAt).toTimeString().slice(0, 8)} (${fmtDuration(waitMs)})${budget ? ` . wait ${budget.rateLimitWaits}/${cfg.maxRateLimitWaits} this run` : ''}`,
  );
  await runtime.sleep(waitMs);
}

function checkInterrupt() {
  if (stopRequested) throw new Stop('stopped by Ctrl-C');
  if (fs.existsSync(paths.stop)) throw new Stop(`found ${paths.stop}, stopping`);
}

// ─── durable state ─────────────────────────────────────────────────────────────

const STATE_SCHEMA_VERSION = 1;

/**
 * Every stage a checkpoint can stand at. The issue stages are the ones WO-2 introduced
 * and are what a resume dispatches on; PHASE_REVIEW is recorded for diagnostics only -
 * a phase review is read-only, so there is never anything of its own to resume.
 */
const STAGES = [
  'PREPARE',
  'IMPLEMENT',
  'ISSUE_GATE',
  'ISSUE_REVIEW',
  'REPAIR',
  'COMMIT',
  'CLOSE_ISSUE',
  'VERIFY_CLOSED',
  'PHASE_REVIEW',
];

/**
 * The stages that leave uncommitted work in the tree. Only these may relax the
 * clean-tree guard at startup: at CLOSE_ISSUE the work is already committed, and a
 * phase review never writes, so dirt at those stages belongs to somebody else.
 */
const DIRT_EXPLAINED_BY = new Set([
  'IMPLEMENT',
  'ISSUE_GATE',
  'ISSUE_REVIEW',
  'REPAIR',
  'COMMIT',
]);

/**
 * Writes the checkpoint atomically: a temporary file in the same directory, then a
 * rename, so a run killed mid-write leaves either the old checkpoint or the new one and
 * never a half-written one. A failure here is logged rather than thrown - losing the
 * checkpoint costs a repeated stage, losing the run costs the whole issue.
 */
function writeState(fields) {
  const next = {
    schemaVersion: STATE_SCHEMA_VERSION,
    ...fields,
    updatedAt: new Date().toISOString(),
  };
  const tmp = `${paths.state}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
    fs.renameSync(tmp, paths.state);
  } catch (err) {
    log(`  ! could not write the checkpoint: ${err.message}`);
  }
  return next;
}

/**
 * Reads the checkpoint, or null when there is none.
 *
 * Anything present but unusable is a hard stop, never a shrug: a checkpoint the loop
 * cannot read is exactly the situation in which guessing re-implements work that is
 * already in the tree.
 */
function readState() {
  if (!fs.existsSync(paths.state)) return null;

  let raw;
  try {
    raw = fs.readFileSync(paths.state, 'utf8');
  } catch (err) {
    throw new Stop(
      `${paths.state} exists but cannot be read (${err.message}) - inspect it, then delete it to start the issue over`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Stop(
      `${paths.state} is not valid JSON - inspect it, then delete it to start the issue over`,
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Stop(`${paths.state} is not a checkpoint object - delete it to start the issue over`);
  }
  if (parsed.schemaVersion !== STATE_SCHEMA_VERSION) {
    throw new Stop(
      `${paths.state} has schemaVersion ${JSON.stringify(parsed.schemaVersion)}, this orchestrator writes ${STATE_SCHEMA_VERSION} - delete it to start the issue over`,
    );
  }
  for (const key of ['feature', 'branch', 'stage']) {
    if (!parsed[key]) {
      throw new Stop(
        `${paths.state} has no ${key} - it is not a usable checkpoint, delete it to start the issue over`,
      );
    }
  }
  if (!STAGES.includes(parsed.stage)) {
    throw new Stop(
      `${paths.state} records the unknown stage ${JSON.stringify(parsed.stage)} - delete it to start the issue over`,
    );
  }
  return parsed;
}

/**
 * The clean-tree half of the startup guard, as a value rather than an exit.
 *
 * Returns the reason to refuse, or null to go ahead. A resumed issue is legitimately
 * dirty - the dirt is its own unfinished work - but only at a stage that leaves work in
 * the tree, and only with a checkpoint that says so. Without one the loop still refuses
 * rather than sweep somebody else's edits into an issue's commit. The branch half of the
 * guard is untouched and stays in main: it stops the loop running a stale copy of itself.
 */
function startupTreeRefusal(checkpoint, dirty) {
  if (!dirty) return null;
  if (checkpoint && DIRT_EXPLAINED_BY.has(checkpoint.stage)) return null;
  const why = checkpoint
    ? `the checkpoint stands at ${checkpoint.stage}, a stage that leaves a clean tree`
    : `no checkpoint in ${paths.state} explains it`;
  return `Working tree is not clean and ${why} - commit or stash first:
${dirty}`;
}

/** Cleared only after a close GitHub has confirmed, or once a phase is merged. */
function clearState() {
  try {
    fs.rmSync(paths.state, { force: true });
    fs.rmSync(`${paths.state}.tmp`, { force: true });
  } catch {
    /* a checkpoint that outlives its work is caught by the HEAD check on resume */
  }
}

/** The checkpoint, only if it belongs to this feature and this phase branch. */
function stateFor(cfg, phase) {
  const state = readState();
  if (!state) return null;
  if (state.feature !== cfg.feature || state.branch !== phase.branch) return null;
  return state;
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

// ─── issue pipeline ────────────────────────────────────────────────────────────

const FORMATTABLE = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|scss|ya?ml)$/i;
const CONVENTIONAL_SUBJECT =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-zA-Z0-9._/-]+\))?!?: .{3,}$/;

/** The end of a command's output: a repair prompt wants the error, not the whole run. */
function tailOf(text, lines = 60, chars = 6000) {
  const kept = String(text || '')
    .trimEnd()
    .split('\n')
    .slice(-lines)
    .join('\n');
  return kept.length > chars ? `...\n${kept.slice(-chars)}` : kept;
}

/**
 * PREPARE. The base commit is the anchor everything downstream speaks in terms of: the
 * gate, the reviewer's diff and the commit. Without it the session reviewed
 * `master...HEAD` and read tens of kilobytes of code no one had asked about.
 *
 * A dirty tree is accepted only for an issue that already has a base recorded - that is
 * a retry, and what is in the tree is the previous attempt at this same issue. Anything
 * else belongs to somebody else and must not be swept into this commit.
 */
function prepareIssue(phase, cfg, budget, issue) {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').stdout;
  if (branch !== phase.branch) {
    throw new Stop(
      `expected to be on ${phase.branch} for issue #${issue.number} but the checkout is on ${branch}`,
    );
  }

  let baseSha = budget.baseSha.get(issue.number) || null;
  if (!baseSha) {
    const dirty = git('status', '--porcelain').stdout;
    if (dirty) {
      throw new Stop(
        `the working tree is not clean before issue #${issue.number}, refusing to start:\n${dirty}`,
      );
    }
    baseSha = git('rev-parse', 'HEAD').stdout;
    budget.baseSha.set(issue.number, baseSha);
  }

  // One narrow read of the issue. The session is handed the body rather than sent to
  // fetch it, which also stops it wandering into comments and linked issues.
  let body = '';
  let labels = [];
  try {
    const parsed = JSON.parse(
      ghTry('issue', 'view', String(issue.number), '--json', 'body,labels').stdout ||
        '{}',
    );
    body = String(parsed.body || '');
    labels = (parsed.labels || []).map((l) => String(l.name || l));
  } catch {
    /* the title alone still names the work; the session can ask for nothing more */
  }
  if (body.length > cfg.issueBodyChars) {
    body = `${body.slice(0, cfg.issueBodyChars)}\n[body truncated by the orchestrator]`;
  }
  return { baseSha, body, labels, suggestion: null };
}

/**
 * Everything the session touched. Staged first, because `git diff <sha>` does not see a
 * file that is not tracked yet and most issues create files.
 */
function changedFiles(baseSha) {
  git('add', '-A');
  return git('diff', '--name-only', baseSha)
    .stdout.split('\n')
    .map((f) => f.trim())
    .filter(Boolean);
}

/**
 * ISSUE_GATE - the deterministic half of the review, run by the orchestrator.
 *
 * Output is captured, not inherited: a step that passes must leave nothing behind for a
 * model to read. Today the session runs these commands itself and every one of their
 * outputs rides along in the rest of that session's context.
 *
 * A step declares `when` (a path prefix - it runs only if the change touches that
 * workspace) and `files` (the changed files are appended to the command).
 */
function runIssueGate(cfg, files) {
  for (const step of cfg.issueGate) {
    if (step.when && !files.some((f) => f.startsWith(step.when))) continue;

    let args = step.run.slice(1);
    if (step.files) {
      const targets = files.filter((f) => FORMATTABLE.test(f) && fs.existsSync(f));
      if (targets.length === 0) continue;
      args = [...args, ...targets];
    }

    const [file, spawnArgs, extra] = shimSpawnArgs(step.run[0], args);
    const r = runtime.spawnSync(file, spawnArgs, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      ...extra,
    });
    if (r.error || r.status !== 0) {
      const output = r.error ? r.error.message : `${r.stdout || ''}\n${r.stderr || ''}`;
      log(`  x gate ${step.name} failed`);
      return {
        step: step.name,
        command: [step.run[0], ...args].join(' '),
        output: tailOf(output),
      };
    }
    log(`  . gate ${step.name} ok`);
  }
  return null;
}

/** The `COMMIT: <subject>` line a session ends with, if it wrote one. */
function suggestedCommit(text) {
  const lines = String(text || '').match(/^[ \t]*COMMIT:[ \t]*(.+)$/gim);
  if (!lines) return null;
  return lines[lines.length - 1].replace(/^[ \t]*COMMIT:[ \t]*/i, '').trim();
}

/**
 * The session may suggest a subject, and it is used only if it really is a conventional
 * commit subject. Otherwise the message is built from the issue. No session is ever
 * spawned just to write a commit message.
 */
function commitMessageFor(suggestion, issue, labels) {
  const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();
  const subject = suggestion ? oneLine(suggestion) : '';
  if (subject.length > 0 && subject.length <= 100 && CONVENTIONAL_SUBJECT.test(subject)) {
    return `${subject}\n\nCloses #${issue.number}`;
  }
  const type = labels.some((l) => /^(bug|fix|defect)$/i.test(l)) ? 'fix' : 'feat';
  return `${type}: ${oneLine(issue.title).slice(0, 72)}\n\nCloses #${issue.number}`;
}

/**
 * COMMIT, CLOSE_ISSUE and VERIFY_CLOSED, all by the orchestrator.
 *
 * Issues #35 and #37 were implemented and committed by their session, which then did
 * not close them, and the loop spent a whole further session on each to find that out.
 * GitHub state is still the source of truth - nothing now depends on a model
 * remembering to write it.
 */
function commitIssue(issue, ctx) {
  git('add', '-A');
  if (!git('diff', '--cached', '--name-only').stdout) {
    throw new Stop(`nothing to commit for issue #${issue.number} after a green gate`);
  }

  // The pre-commit hook runs here exactly as it does for a human. It costs nothing in
  // context any more: the orchestrator reads its output, not a session.
  const commit = gitTry(
    'commit',
    '-m',
    commitMessageFor(ctx.suggestion, issue, ctx.labels),
  );
  if (commit.code !== 0) {
    throw new Stop(
      `the commit for issue #${issue.number} was refused, the work is staged and left in place:\n${tailOf(`${commit.stdout}\n${commit.stderr}`, 30)}`,
    );
  }
  return git('rev-parse', 'HEAD').stdout;
}

function closeIssue(issue, sha) {
  const closed = ghTry(
    'issue',
    'close',
    String(issue.number),
    '--comment',
    `Implemented in ${sha}`,
  );
  if (closed.code !== 0) {
    throw new Stop(
      `issue #${issue.number} is implemented and committed as ${sha.slice(0, 8)} but closing it failed (${tailOf(closed.stderr, 3)}) - re-run and the checkpoint closes it without re-implementing anything`,
    );
  }
}

/** GitHub's own answer, never the exit code of the close: an unreadable answer is not closed. */
function issueState(issue) {
  try {
    return String(
      JSON.parse(
        ghTry('issue', 'view', String(issue.number), '--json', 'state').stdout || '{}',
      ).state || '',
    ).toUpperCase();
  } catch {
    return '';
  }
}

function verifyClosed(issue, sha) {
  const state = issueState(issue);
  if (state !== 'CLOSED') {
    throw new Stop(
      `issue #${issue.number} reads ${state || 'unknown'} on GitHub after being closed, the work is committed as ${sha.slice(0, 8)} - check GitHub before re-running, do not re-implement it`,
    );
  }
}

function commitAndClose(issue, ctx) {
  const sha = commitIssue(issue, ctx);
  closeIssue(issue, sha);
  verifyClosed(issue, sha);
  return sha;
}

/**
 * What to make of a finished session, before anything is read out of it. Fail-closed: a
 * session that did not complete yields no verdict, no commit and no close.
 */
async function settleSession(st, cfg, opts, what, budget) {
  const outcome = sessionOutcome(st);
  if (st.denials.length > 0 && outcome && !abortedByRateLimit(st)) {
    throw new Stop(
      `${what} was denied ${deniedTools(st)} and did not complete (${outcome}) - add it to allowedTools in ${CONFIG_DEFAULT} and re-run`,
    );
  }
  reportDenials(st, what);
  await handleRateLimit(st, cfg, opts, budget);
  if (abortedByRateLimit(st)) {
    return { status: 'rate-limited', note: `${what} was cut off by the rate limit` };
  }
  if (outcome) return { status: 'open', note: `${what} did not complete (${outcome})` };
  return null;
}

/**
 * One issue, end to end:
 *
 *   PREPARE -> IMPLEMENT -> ISSUE_GATE -> ISSUE_REVIEW
 *           -> REPAIR (only when the gate or the review blocks) -> back to the gate
 *           -> COMMIT -> CLOSE_ISSUE -> VERIFY_CLOSED
 *
 * The implementation session no longer reviews itself, commits or closes anything. The
 * review it used to run on its own diff was self-review over the wrong range whose
 * verdict bound nothing; this reviewer is a separate read-only session over exactly the
 * issue's diff, and its verdict decides whether a commit happens at all.
 *
 * Each stage is checkpointed to paths.state before it runs, so an interruption - a rate
 * limit, a Ctrl-C, a crash - resumes that stage rather than the issue. The checkpoint is
 * read here rather than handed in, because both ways back into this function have to
 * honour it: the retry inside drainIssues after a rate limit, and the next process.
 */
async function runIssue(phase, cfg, opts, budget, issue) {
  const ctx = prepareIssue(phase, cfg, budget, issue);

  const mark = (stage, extra) => {
    if (extra) Object.assign(ctx, extra);
    writeState({
      feature: cfg.feature,
      phase: phase.index,
      milestone: phase.milestone,
      branch: phase.branch,
      issue: issue.number,
      issueBaseSha: ctx.baseSha,
      stage,
      reviewRound: ctx.reviewRound === undefined ? null : ctx.reviewRound,
      commitSha: ctx.commitSha === undefined ? null : ctx.commitSha,
      // Not in the work order's schema, and cheap to carry: without it a resumed issue
      // loses the subject the session suggested and commits a message built from the
      // issue title instead.
      commitSubject: ctx.suggestion || null,
    });
  };

  const closeOut = (sha) => {
    mark('CLOSE_ISSUE', { commitSha: sha });
    closeIssue(issue, sha);
    mark('VERIFY_CLOSED');
    verifyClosed(issue, sha);
    // The only place the checkpoint is dropped: GitHub has confirmed the close.
    clearState();
    return sha;
  };
  const commitCloseOut = () => {
    mark('COMMIT');
    return closeOut(commitIssue(issue, ctx));
  };

  const saved = stateFor(cfg, phase);
  const resume = saved && saved.issue === issue.number ? saved : null;
  if (resume) {
    const expected = resume.commitSha || resume.issueBaseSha;
    const head = git('rev-parse', 'HEAD').stdout;
    if (expected && head !== expected) {
      throw new Stop(
        `the checkpoint for issue #${issue.number} stands at ${resume.stage} and expects ${phase.branch} at ${expected.slice(0, 8)}, but HEAD is ${head.slice(0, 8)} - work out which is right, then delete ${paths.state} to start the issue over`,
      );
    }
    ctx.suggestion = resume.commitSubject || null;
  }

  // Work that is already committed is never done twice. GitHub is asked first: an issue
  // somebody closed by hand while the loop was down needs no work at all.
  if (resume && resume.commitSha) {
    if (issueState(issue) === 'CLOSED') {
      clearState();
      return {
        status: 'closed',
        note: `already committed as ${resume.commitSha.slice(0, 8)} and closed`,
      };
    }
    log(
      `~ resuming issue #${issue.number} at CLOSE_ISSUE - it is committed as ${resume.commitSha.slice(0, 8)}, only the close is left`,
    );
    return { status: 'closed', note: `committed ${closeOut(resume.commitSha).slice(0, 8)}` };
  }

  // A checkpoint past IMPLEMENT is worth honouring only while the work it describes is
  // still in the tree; if somebody discarded it, the honest thing is to implement again.
  let entry = 'IMPLEMENT';
  if (resume && !['PREPARE', 'IMPLEMENT', 'PHASE_REVIEW'].includes(resume.stage)) {
    if (changedFiles(ctx.baseSha).length === 0) {
      log(
        `~ the checkpoint for issue #${issue.number} stands at ${resume.stage} but nothing is left in the tree - implementing it again`,
      );
    } else {
      entry = resume.stage;
    }
  }

  const slots = (extra) => ({
    issue: issue.number,
    title: issue.title,
    milestone: phase.milestone,
    branch: phase.branch,
    featureBranch: cfg.featureBranch,
    baseSha: ctx.baseSha,
    body: ctx.body,
    ...extra,
  });

  const charge = (kind, stage, st, model, effort) => {
    recordStats(kind, phase, issue.number, st, { stage, model, effort });
    budget.phaseTokens += st.grossInputTokens;
    budget.runTokens += st.grossInputTokens;
    budget.runCost += st.cost;
    budget.perIssue.set(
      issue.number,
      (budget.perIssue.get(issue.number) || 0) + st.grossInputTokens,
    );
  };

  // Browser tools only for an issue that is about the browser. A storage or schema
  // issue that can reach for Playwright eventually does.
  const browser = ctx.labels.some((have) =>
    cfg.browserIssueLabels.some((l) => l.toLowerCase() === have.toLowerCase()),
  );
  const implAllowed = cfg.allowedTools.filter(
    (t) => browser || !cfg.browserTools.some((b) => t.startsWith(b)),
  );
  const implSession = (prompt) => ({
    model: cfg.implModel,
    maxTurns: cfg.maxTurns,
    stallSeconds: cfg.stallSeconds,
    allowedTools: implAllowed,
    tools: cfg.implTools,
    disallowedTools: cfg.implDisallowedTools,
    disableSlashCommands: true,
    effort: cfg.implEffort,
    prompt,
  });

  // Review approved, no commit: nothing left to think about, and no session to pay for.
  if (entry === 'COMMIT') {
    log(
      `~ resuming issue #${issue.number} at COMMIT - the review already approved it, only the commit is left`,
    );
    return { status: 'closed', note: `committed ${commitCloseOut().slice(0, 8)}` };
  }

  let st = null;
  let settled = null;
  if (entry === 'IMPLEMENT') {
    mark('IMPLEMENT');
    st = await runSession({
      ...implSession(fillPrompt(cfg.implPrompt, slots())),
      maxCostUsd: cfg.implMaxCostUsd,
    });
    charge('impl', 'IMPLEMENT', st, cfg.implModel, cfg.implEffort);
    settled = await settleSession(st, cfg, opts, 'the implementation session', budget);
    if (settled) return settled;
    ctx.suggestion = suggestedCommit(st.resultText);
  } else {
    log(
      `~ resuming issue #${issue.number} at ${entry} - the implementation is already in the tree, not repeating it`,
    );
  }

  // Only for the first round, and only when the checkpoint says the gate had already
  // passed: what was cut off then was the review, so the review is what repeats.
  let gateAlreadyGreen = entry === 'ISSUE_REVIEW';

  for (let round = 1; ; round++) {
    checkInterrupt();
    const files = changedFiles(ctx.baseSha);
    if (files.length === 0) {
      return { status: 'open', note: 'the session changed nothing' };
    }

    let findings = null;
    let failure = null;
    if (gateAlreadyGreen) {
      log('  . the checkpoint recorded a green gate, going straight back to the review');
      gateAlreadyGreen = false;
    } else {
      mark('ISSUE_GATE', { reviewRound: round });
      failure = runIssueGate(cfg, files);
    }
    if (failure) {
      findings = [
        `The gate step "${failure.step}" failed.`,
        `Command: ${failure.command}`,
        '',
        failure.output,
      ].join('\n');
    } else {
      mark('ISSUE_REVIEW', { reviewRound: round });
      const treeBefore = git('status', '--porcelain').stdout;
      const stat = git('diff', '--shortstat', ctx.baseSha).stdout;
      log(
        `> issue review . ${files.length} file(s) . ${stat || 'no change reported'} . ${cfg.issueReviewModel} . effort ${cfg.issueReviewEffort}`,
      );
      // Not a limit, a warning: an issue whose diff is this big was filed too large,
      // and any review of it is shallower than it looks.
      const changed =
        Number((stat.match(/(\d+) insertion/) || [])[1] || 0) +
        Number((stat.match(/(\d+) deletion/) || [])[1] || 0);
      if (changed > cfg.issueDiffWarnLines) {
        log(
          `  ! ${changed} changed lines for one issue - the review will be shallower than it looks, consider splitting the issue`,
        );
      }
      const rv = await runSession({
        model: cfg.issueReviewModel,
        maxTurns: cfg.maxTurns,
        stallSeconds: cfg.stallSeconds,
        allowedTools: cfg.issueReviewTools,
        tools: cfg.issueReviewTools,
        disallowedTools: cfg.issueReviewDisallowedTools,
        disableSlashCommands: true,
        effort: cfg.issueReviewEffort,
        maxCostUsd: cfg.issueReviewMaxCostUsd,
        prompt: fillPrompt(cfg.issueReviewPrompt, slots({ files: files.join('\n') })),
      });
      charge(
        'issue-review',
        'ISSUE_REVIEW',
        rv,
        cfg.issueReviewModel,
        cfg.issueReviewEffort,
      );
      settled = await settleSession(rv, cfg, opts, 'the issue review', budget);
      if (settled) return settled;

      // Read-only is asserted at the CLI; this is the check that it held.
      if (git('status', '--porcelain').stdout !== treeBefore) {
        throw new Stop(
          `the reviewer changed the working tree while reviewing issue #${issue.number}, its verdict is not trusted`,
        );
      }

      const verdict = readVerdict(rv.resultText);
      log(
        `  review: ${verdict} . $${rv.cost.toFixed(2)} . ${rv.apiRequests} req . ${fmtDuration(rv.durationMs)}`,
      );
      if (verdict === 'APPROVED') {
        return { status: 'closed', note: `committed ${commitCloseOut().slice(0, 8)}` };
      }
      findings = rv.resultText.trim();
    }

    if (round > cfg.maxIssueRepairs) {
      throw new Stop(
        `issue #${issue.number} still does not pass after ${cfg.maxIssueRepairs} repair round(s), nothing was committed and the work is left in the tree - see ${paths.log}`,
      );
    }
    log(`~ repair ${round}/${cfg.maxIssueRepairs} for issue #${issue.number}`);

    mark('REPAIR', { reviewRound: round });
    st = await runSession({
      ...implSession(fillPrompt(cfg.repairPrompt, slots({ findings }))),
      maxCostUsd: cfg.repairMaxCostUsd,
    });
    charge('repair', 'REPAIR', st, cfg.implModel, cfg.implEffort);
    settled = await settleSession(st, cfg, opts, 'the repair session', budget);
    if (settled) return settled;
    ctx.suggestion = suggestedCommit(st.resultText) || ctx.suggestion;
  }
}

// ─── phase execution ───────────────────────────────────────────────────────────

/** Runs the issue pipeline until the milestone has no open issues left. */
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

    const costBefore = budget.runCost;
    const startedAt = Date.now();
    const result = await runIssue(phase, cfg, opts, budget, issue);

    const issueTokens = budget.perIssue.get(issue.number) || 0;
    const summary = `$${(budget.runCost - costBefore).toFixed(2)} . ${fmtDuration(Date.now() - startedAt)} . ${fmtTokens(issueTokens)} gross in . ${result.note} . run total $${budget.runCost.toFixed(2)}`;
    const closed = result.status === 'closed';

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
      budget.baseSha.delete(issue.number);
      budget.issuesClosed++;
      log(`+ issue #${issue.number} closed . ${summary}`);
      if (overBudget) throw budgetStop();
      // GitHub stays the source of truth even though the orchestrator did the closing:
      // re-reading also picks up an issue somebody closed by hand meanwhile.
      open = openIssues(phase.milestone);
      continue;
    }

    // A session the rate limit cut off did not fail at the task, it never got to
    // finish it. Charging it an attempt means a limit arriving twice looks exactly
    // like an issue that cannot be implemented.
    if (result.status === 'rate-limited') {
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
  let limitAborts = 0;

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
    writeState({
      feature: cfg.feature,
      phase: phase.index,
      milestone: phase.milestone,
      branch: phase.branch,
      issue: null,
      issueBaseSha: null,
      stage: 'PHASE_REVIEW',
      reviewRound: round,
      commitSha: null,
    });

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
    await handleRateLimit(st, cfg, opts, budget);

    // The phase review had no rate-limit branch at all: a limit here fell straight
    // through to sessionOutcome and ended the whole run, throwing away every issue the
    // phase had already finished. Only drainIssues ever retried. A review the limit cut
    // off did not fail at reviewing, so it repeats without costing a review round.
    if (abortedByRateLimit(st)) {
      limitAborts++;
      if (limitAborts > cfg.maxRateLimitRetries) {
        throw new Stop(
          `the review of phase "${phase.milestone}" was cut off by the rate limit ${limitAborts} times, stopping instead of retrying further`,
        );
      }
      log(
        `~ the phase review was cut off by the rate limit, repeating it without charging a round (${limitAborts}/${cfg.maxRateLimitRetries})`,
      );
      round--;
      continue;
    }

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
  budget.baseSha = new Map();
  budget.phaseTokens = 0;

  // A checkpoint for this phase carries the anchor its issue was measured from. Seeding
  // it here is what lets prepareIssue accept the tree the interrupted attempt left: the
  // dirt is that issue's own work, and re-anchoring on HEAD would hide it from the gate,
  // the reviewer and the commit.
  const resume = stateFor(cfg, phase);
  if (resume && resume.issue && resume.issueBaseSha) {
    budget.baseSha.set(resume.issue, resume.issueBaseSha);
    log(
      `  checkpoint: issue #${resume.issue} at ${resume.stage}, base ${resume.issueBaseSha.slice(0, 8)}, written ${resume.updatedAt}`,
    );
  }

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
  // The phase is in the feature branch: the PHASE_REVIEW checkpoint has nothing left
  // to describe, and leaving it would make the next run report a stale stage.
  clearState();

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

function printPlan(phases, cfg, base, checkpoint) {
  const issueCost = estimateCost(ISSUE_KINDS, BASELINE_ISSUE_COST_USD, {
    perIssue: true,
  });
  const reviewCost = estimateCost('phase-review', BASELINE_REVIEW_COST_USD);
  const perIssueTokens = estimateIssueTokens();
  let issues = 0;
  let usd = 0;
  let tokens = 0;
  let sessions = 0;
  let planned = 0;

  const provenance = (e) => {
    if (e.fromBaseline) return `baseline, ${e.samples} sample(s)`;
    const source =
      e.samples === e.sessions
        ? `median of ${e.samples} from ${paths.stats}`
        : `median of ${e.samples} across ${e.sessions} sessions`;
    // Worth saying out loud: the legacy rows' token counts are unusable, but their
    // cost came from the CLI and is directly comparable with a v2 row's.
    return e.legacyOnly ? `${source}, all legacy v1 rows - cost is still comparable` : source;
  };

  console.log(
    [
      '',
      `Feature "${cfg.feature}" on ${cfg.featureBranch} -> pull request into ${base} (you merge it)`,
      `Per issue:  $${issueCost.usd.toFixed(2)} (${provenance(issueCost)})`,
      `Per review: $${reviewCost.usd.toFixed(2)} (${provenance(reviewCost)})`,
      checkpoint
        ? `Checkpoint: ${checkpoint.issue ? `issue #${checkpoint.issue}` : 'phase'} at ${checkpoint.stage} on ${checkpoint.branch} (${checkpoint.updatedAt}) - a real run resumes there`
        : 'Checkpoint: none - a real run starts the next open issue from scratch',
      '',
    ].join('\n'),
  );

  for (const phase of phases) {
    const open = openIssues(phase.milestone);
    if (open.length === 0 && phaseIsMerged(phase, cfg, base)) {
      console.log(`  = ${phase.milestone} - already merged`);
      continue;
    }
    planned++;
    const phaseUsd = issueCost.usd * open.length + reviewCost.usd;
    const phaseTokens = perIssueTokens * open.length + BASELINE_REVIEW_TOKENS;
    // Per attempt: one implementation, up to maxIssueRepairs repairs, and one review
    // after each of them.
    const perIssueSessions = cfg.maxIssueAttempts * (2 * cfg.maxIssueRepairs + 2);
    const phaseSessions = open.length * perIssueSessions + cfg.maxReviewRounds;
    issues += open.length;
    usd += phaseUsd;
    tokens += phaseTokens;
    sessions += phaseSessions;
    console.log(
      `  ${String(open.length).padStart(2)} issues  ~$${phaseUsd.toFixed(2).padStart(6)}  ~${fmtTokens(phaseTokens).padStart(6)} gross  <= ${String(phaseSessions).padStart(2)} sessions   ${phase.milestone}`,
    );
  }

  console.log(
    [
      '',
      `Total: ${planned} phases, ${issues} issues, ~$${usd.toFixed(2)}, ~${fmtTokens(tokens)} gross input, at most ${sessions} sessions`,
      'No session was started.',
      '',
    ].join('\n'),
  );
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

  // Read before anything else looks at the tree: a checkpoint that cannot be read is a
  // hard stop, because guessing is exactly how work already in the tree gets redone.
  let checkpoint = null;
  try {
    checkpoint = readState();
  } catch (err) {
    if (!(err instanceof Stop)) throw err;
    fail(err.message);
  }

  if (opts.dryRun) {
    printPlan(phases, cfg, base, checkpoint);
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

  if (checkpoint && checkpoint.feature !== cfg.feature) {
    fail(
      `${paths.state} is a checkpoint of feature "${checkpoint.feature}" but this run is "${cfg.feature}" - finish that run or delete its checkpoint first`,
    );
  }
  if (checkpoint) {
    log(
      `| checkpoint found: ${checkpoint.issue ? `issue #${checkpoint.issue}` : 'phase'} at ${checkpoint.stage} on ${checkpoint.branch}, written ${checkpoint.updatedAt}`,
    );
  }

  // The clean-tree guard, relaxed exactly as far as a checkpoint can account for. A
  // resumed issue is legitimately dirty - the dirt is its own unfinished work - but only
  // at a stage that leaves work in the tree, and only with a checkpoint that says so.
  // Without one, the loop still refuses to start rather than sweep up somebody's edits.
  const dirty = git('status', '--porcelain').stdout;
  const refusal = startupTreeRefusal(checkpoint, dirty);
  if (refusal) fail(refusal);
  if (dirty) {
    log(
      `| the working tree is dirty and the checkpoint accounts for it (issue #${checkpoint.issue} at ${checkpoint.stage}) - resuming there`,
    );
  }

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
    baseSha: new Map(),
    rateLimitWaits: 0,
  };
  const startedAt = Date.now();
  let executed = 0;

  log(
    `> Ralph Loop . feature "${cfg.feature}" . branch ${cfg.featureBranch} . trunk ${base} . impl ${cfg.implModel} (effort ${cfg.implEffort || 'default'}, cap $${cfg.implMaxCostUsd}) . issue review ${cfg.issueReviewModel} (effort ${cfg.issueReviewEffort}, cap $${cfg.issueReviewMaxCostUsd}) . phase review ${cfg.reviewModel} (effort ${cfg.reviewEffort || 'default'}, cap $${cfg.phaseReviewMaxCostUsd})`,
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
      `= run finished . $${budget.runCost.toFixed(2)} . ${executed} phase(s) . ${budget.issuesClosed} issue(s) closed . ${fmtTokens(budget.runTokens)} gross in . ${fmtDuration(Date.now() - startedAt)}`,
    );
  } catch (err) {
    if (!(err instanceof Stop)) throw err;
    log(`!! STOPPED: ${err.message}`);
    log(
      `  run so far: $${budget.runCost.toFixed(2)} . ${executed} phase(s) . ${budget.issuesClosed} issue(s) . ${fmtTokens(budget.runTokens)} gross in . ${fmtDuration(Date.now() - startedAt)}`,
    );
    log(
      `  branch ${git('rev-parse', '--abbrev-ref', 'HEAD').stdout} left as is; re-running picks up from here`,
    );
    let left = null;
    try {
      left = readState();
    } catch {
      /* already reported by whoever wrote it */
    }
    if (left) {
      log(
        `  checkpoint: ${left.issue ? `issue #${left.issue}` : 'phase'} at ${left.stage} in ${paths.state} - the next run resumes that stage, it does not repeat the issue`,
      );
    }
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
  reviewPhase,
  runIssue,
  prepareIssue,
  changedFiles,
  runIssueGate,
  settleSession,
  suggestedCommit,
  commitMessageFor,
  commitAndClose,
  commitIssue,
  closeIssue,
  verifyClosed,
  issueState,
  handleRateLimit,
  readState,
  writeState,
  clearState,
  stateFor,
  startupTreeRefusal,
  STAGES,
  DIRT_EXPLAINED_BY,
  STATE_SCHEMA_VERSION,
  tailOf,
  recordStats,
  readVerdict,
  sessionOutcome,
  abortedByRateLimit,
  deniedTools,
  buildStatsRow,
  estimateIssueTokens,
  estimateCost,
  median,
  phaseTag,
  shimSpawnArgs,
  fmtTokens,
  fmtDuration,
  main,
};
