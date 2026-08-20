'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ralph = require('../ralph-start.js');
const { fakeSpawn, withFakes } = require('./helpers/fake-runtime');

// The completed fixture is worth 68,700 gross input tokens.
const FIXTURE_GROSS = 68700;

const config = (over) => ({
  implModel: 'sonnet',
  implEffort: 'medium',
  maxTurns: 100,
  stallSeconds: 120,
  allowedTools: ['Bash', 'Read'],
  implPrompt: 'implement #{issue}',
  issueBudgetTokens: 1_000_000,
  maxIssueAttempts: 2,
  maxRateLimitRetries: 3,
  onRateLimit: 'stop',
  ...over,
});

const newBudget = () => ({
  runTokens: 0,
  runCost: 0,
  issuesClosed: 0,
  phaseTokens: 0,
  phaseLimit: Infinity,
  perIssue: new Map(),
  attempts: new Map(),
  limitAborts: new Map(),
});

/**
 * Runs drainIssues over one issue with everything faked: gh answers from a script, the
 * session replays a fixture, and the run's own state goes to a temp directory so the
 * real ralph.stats.jsonl - the baseline the loop is measured against - is untouched.
 */
async function drainOne({ cfg, closesIssue = true, fixture = 'session-completed' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'));
  const original = { ...ralph.paths };
  const quiet = console.log;

  ralph.paths.log = path.join(dir, 'ralph.log');
  ralph.paths.stats = path.join(dir, 'ralph.stats.jsonl');
  ralph.paths.stop = path.join(dir, 'ralph.stop');
  console.log = () => {};

  let listCalls = 0;
  const spawnSync = (file, args) => {
    const line = [file, ...(args || [])].join(' ');
    if (line.includes('issue list')) {
      listCalls++;
      // First call picks the issue up; the call after the session decides whether the
      // session closed it, which is the only progress signal the loop trusts.
      const open =
        listCalls === 1 || !closesIssue ? [{ number: 41, title: 'Stream it' }] : [];
      return { status: 0, stdout: JSON.stringify(open), stderr: '' };
    }
    throw new Error(`unexpected command in test: ${line}`);
  };

  const restore = withFakes(ralph, { spawnSync, spawn: fakeSpawn({ fixture }) });
  const budget = newBudget();
  try {
    const phase = { index: 4, milestone: 'Phase 4: Avatar streaming', branch: 'b' };
    const opts = { issues: null, stopOnLimit: false };
    const error = await drainIssues(phase, cfg, opts, budget);
    return { budget, error, statsFile: ralph.paths.stats };
  } finally {
    restore();
    console.log = quiet;
    Object.assign(ralph.paths, original);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  async function drainIssues(...args) {
    try {
      await ralph.drainIssues(...args);
      return null;
    } catch (err) {
      return err;
    }
  }
}

test('a closed issue over budget is caught', async () => {
  // The regression: the check used to sit after `if (closed) continue`, so a session
  // that closed its issue was never measured. Issue #40 ran to 15.6M against a 6M cap
  // and the loop said nothing.
  const { error, budget } = await drainOne({
    cfg: config({ issueBudgetTokens: 1000 }),
    closesIssue: true,
  });

  assert.ok(error, 'the run stopped');
  assert.match(error.message, /issue #41 used .* of its .* budget/);
  assert.equal(budget.issuesClosed, 1, 'the issue really did close first');
});

test('a closed issue within budget does not stop the run', async () => {
  const { error, budget } = await drainOne({
    cfg: config({ issueBudgetTokens: 10_000_000 }),
    closesIssue: true,
  });

  assert.equal(error, null);
  assert.equal(budget.issuesClosed, 1);
  assert.equal(budget.perIssue.get(41), FIXTURE_GROSS);
  assert.ok(budget.runCost > 0, 'cost was accounted for');
});

test('an issue left open over budget is still caught', async () => {
  const { error } = await drainOne({
    cfg: config({ issueBudgetTokens: 1000, maxIssueAttempts: 5 }),
    closesIssue: false,
  });

  assert.ok(error);
  assert.match(error.message, /used .* of its .* budget/);
});

test('the budget counts gross tokens, not the API input alone', async () => {
  // Gross is what a v1 row expressed, so the configured budget keeps its meaning.
  const { budget } = await drainOne({
    cfg: config({ issueBudgetTokens: 10_000_000 }),
  });
  assert.equal(budget.phaseTokens, FIXTURE_GROSS);
  assert.equal(budget.runTokens, FIXTURE_GROSS);
});

test('the test harness never writes to the real stats file', async () => {
  const realStats = '.claude/ralph.stats.jsonl';
  const before = fs.existsSync(realStats) ? fs.readFileSync(realStats, 'utf8') : null;

  const { statsFile } = await drainOne({ cfg: config({ issueBudgetTokens: 10_000_000 }) });

  const after = fs.existsSync(realStats) ? fs.readFileSync(realStats, 'utf8') : null;
  assert.equal(after, before, 'the run baseline is untouched');
  assert.ok(statsFile.includes('ralph-test-'), 'stats went to a temp directory');
  assert.deepEqual(ralph.paths.stats, '.claude/ralph.stats.jsonl', 'paths restored');
});
