'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const ralph = require('../ralph-start.js');
const { fakeSpawn, withFakes } = require('./helpers/fake-runtime');
const { fakeRepo, withTempPaths, quiet } = require('./helpers/fake-repo');

// One issue through the pipeline costs the implementation fixture plus the review
// fixture: 399,260 + 103,180 gross input tokens.
const ISSUE_GROSS = 502440;

const config = (over) => ({
  ...ralph.loadConfig('.claude/ralph.config.json'),
  onRateLimit: 'stop',
  issueGate: [{ name: 'test:api', run: ['pnpm', 'test:api'], when: 'apps/api/' }],
  issueBudgetTokens: 6_000_000,
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
  baseSha: new Map(),
  done: new Set(),
});

/**
 * Runs drainIssues over one issue with everything faked: git, gh and pnpm answer from
 * memory, the sessions replay fixtures, and the run's own state goes to a temp
 * directory so `.claude/ralph.stats.jsonl` - the baseline the loop is measured against
 * - is untouched.
 */
async function drainOne({ cfg, fixtures = ['session-impl', 'session-review-approved'], repo = {} }) {
  const spawnSync = fakeRepo(repo);
  const paths = withTempPaths(ralph);
  const loud = quiet();
  const restore = withFakes(ralph, { spawnSync, spawn: fakeSpawn({ fixtures }) });
  const budget = newBudget();

  try {
    const phase = {
      index: 4,
      milestone: 'Phase 4: Avatar streaming',
      branch: 'feature/user-profile-phase-4',
    };
    let error = null;
    try {
      await ralph.drainIssues(phase, cfg, { issues: null, stopOnLimit: false }, budget);
    } catch (err) {
      error = err;
    }
    return { budget, error, repo: spawnSync.state, statsFile: paths.stats };
  } finally {
    restore();
    loud();
    paths.restore();
  }
}

test('a closed issue over budget is caught', async () => {
  // The regression: the check used to sit after `if (closed) continue`, so an issue
  // that closed was never measured. Issue #40 ran to 15.6M against a 6M cap and the
  // loop said nothing.
  const { error, budget, repo } = await drainOne({
    cfg: config({ issueBudgetTokens: 1000 }),
  });

  assert.ok(error, 'the run stopped');
  assert.match(error.message, /issue #41 used .* of its .* budget/);
  assert.equal(repo.commits.length, 1, 'the issue really was finished first');
  assert.equal(budget.issuesClosed, 1, 'and it counts as closed, the run stops anyway');
});

test('a closed issue within budget does not stop the run', async () => {
  const { error, budget, repo } = await drainOne({ cfg: config() });

  assert.equal(error, null);
  assert.equal(budget.issuesClosed, 1);
  assert.equal(budget.perIssue.get(41), ISSUE_GROSS);
  assert.ok(budget.runCost > 0, 'cost was accounted for');
  assert.deepEqual(repo.open, [], 'and GitHub agrees the issue is closed');
});

test('an issue left open over budget is still caught', async () => {
  const { error } = await drainOne({
    cfg: config({ issueBudgetTokens: 1000, maxIssueAttempts: 5 }),
    // The implementation session changed nothing, so the issue stays open.
    repo: { files: [] },
  });

  assert.ok(error);
  assert.match(error.message, /used .* of its .* budget/);
});

test('an issue that will not progress stops the run after its attempts', async () => {
  const { error, repo } = await drainOne({
    cfg: config({ maxIssueAttempts: 2 }),
    repo: { files: [] },
  });

  assert.ok(error);
  assert.match(error.message, /issue #41 is not progressing after 2 attempts/);
  assert.equal(repo.commits.length, 0);
});

test('the budget counts gross tokens, not the API input alone', async () => {
  // Gross is what a v1 row expressed, so the configured budget keeps its meaning.
  const { budget } = await drainOne({ cfg: config() });
  assert.equal(budget.phaseTokens, ISSUE_GROSS);
  assert.equal(budget.runTokens, ISSUE_GROSS);
});

test('the test harness never writes to the real stats file', async () => {
  const realStats = '.claude/ralph.stats.jsonl';
  const before = fs.existsSync(realStats) ? fs.readFileSync(realStats, 'utf8') : null;

  const { statsFile } = await drainOne({ cfg: config() });

  const after = fs.existsSync(realStats) ? fs.readFileSync(realStats, 'utf8') : null;
  assert.equal(after, before, 'the run baseline is untouched');
  assert.ok(statsFile.includes('ralph-test-'), 'stats went to a temp directory');
  assert.deepEqual(ralph.paths.stats, '.claude/ralph.stats.jsonl', 'paths restored');
});

test('a list that has not caught up does not hand the same issue back', async () => {
  // What phase 4 actually did: the loop closed #41, asked GitHub for the open issues,
  // was handed #41 again seconds later, and spent two more sessions re-implementing work
  // that was already committed. Each correctly changed nothing, so the issue then read
  // as one that could not be implemented at all and the run stopped.
  const { error, budget, repo } = await drainOne({
    cfg: config(),
    repo: { listLag: true },
  });

  assert.equal(error, null, error && error.message);
  assert.equal(budget.issuesClosed, 1);
  assert.equal(repo.commits.length, 1, 'committed once, not three times');
  assert.deepEqual([...budget.done], [41]);
  // The list still says it is open; the loop knows better because it closed it itself.
  assert.equal(repo.open.length, 1);
});

test('an issue GitHub already reports closed costs no session at all', async () => {
  const spawnSync = fakeRepo({ listLag: true });
  spawnSync.state.closed.add(41);
  const paths = withTempPaths(ralph);
  const loud = quiet();
  const spawn = fakeSpawn({ fixtures: ['session-impl'] });
  const restore = withFakes(ralph, { spawnSync, spawn });
  try {
    const result = await ralph.runIssue(
      { index: 4, milestone: 'Phase 4: Avatar streaming', branch: 'feature/user-profile-phase-4' },
      config(),
      { issues: null, stopOnLimit: false },
      newBudget(),
      { number: 41, title: 'Stream the avatar' },
    );
    assert.equal(result.status, 'closed');
    assert.match(result.note, /already closed on GitHub/);
    assert.equal(spawn.calls.length, 0, 'no session was started');
    assert.equal(spawnSync.state.commits.length, 0);
  } finally {
    restore();
    loud();
    paths.restore();
  }
});
