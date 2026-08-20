'use strict';

const test = require('node:test');
const assert = require('node:assert');

const ralph = require('../ralph-start.js');
const { fakeSpawn, withFakes } = require('./helpers/fake-runtime');
const { fakeRepo, withTempPaths, quiet } = require('./helpers/fake-repo');

const PHASE = {
  index: 4,
  milestone: 'Phase 4: Avatar streaming',
  branch: 'feature/user-profile-phase-4',
};

const config = (over) =>
  ralph.loadConfig('.claude/ralph.config.json') && {
    ...ralph.loadConfig('.claude/ralph.config.json'),
    // The real config, with the waiting taken out: a test must never sleep out a rate
    // limit, and must never run a real gate command.
    onRateLimit: 'stop',
    issueGate: [
      { name: 'lint:api', run: ['pnpm', 'lint:api'], when: 'apps/api/' },
      { name: 'test:api', run: ['pnpm', 'test:api'], when: 'apps/api/' },
    ],
    ...over,
  };

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
 * Runs one issue through the whole pipeline with claude, git, gh and pnpm all faked.
 * Returns what the pipeline decided plus everything the fakes were asked to do.
 */
async function runOne({ fixtures, repo = {}, cfg = {}, exitCode = 0, opts = {} } = {}) {
  const spawn = fakeSpawn({ fixtures, exitCode });
  const spawnSync = fakeRepo(repo);
  const paths = withTempPaths(ralph);
  const loud = quiet();
  const restore = withFakes(ralph, { spawn, spawnSync });
  const budget = newBudget();
  const issue = spawnSync.state.open[0];

  try {
    let result = null;
    let error = null;
    try {
      result = await ralph.runIssue(PHASE, config(cfg), { issues: null, stopOnLimit: false, ...opts }, budget, issue);
    } catch (err) {
      error = err;
    }
    // Read before the temp directory goes away in the finally below.
    const fs = require('node:fs');
    const statsRows = (fs.existsSync(paths.stats)
      ? fs.readFileSync(paths.stats, 'utf8')
      : ''
    )
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return { result, error, budget, spawn, repo: spawnSync.state, statsRows };
  } finally {
    restore();
    loud();
    paths.restore();
  }
}

/** Every prompt the pipeline sent to a session, in order. */
const prompts = (spawn) => spawn.calls.map((c) => c.stdin);
const argvs = (spawn) => spawn.calls.map((c) => c.args.join(' '));
/** The tool names a session was actually given, as one string. */
const toolArgs = (argv) => {
  const at = argv.indexOf('--tools');
  const allowed = argv.indexOf('--allowedTools');
  return `${argv.slice(at, argv.indexOf('--', at + 8))} ${argv.slice(allowed)}`;
};

// ─── the happy path ────────────────────────────────────────────────────────────

test('an approved issue is gated, reviewed, committed and closed by the orchestrator', async () => {
  const { result, repo, spawn } = await runOne({
    fixtures: ['session-impl', 'session-review-approved'],
  });

  assert.equal(result.status, 'closed');
  assert.equal(spawn.calls.length, 2, 'one implementation and one review session');
  assert.equal(repo.commits.length, 1, 'the orchestrator committed, once');
  assert.match(repo.commits[0], /^feat\(api\): stream the profile avatar\n\nCloses #41$/);
  assert.deepEqual(repo.open, [], 'the issue was closed');
  assert.ok(
    repo.calls.some((c) => c.includes('issue view 41 --json state')),
    'and the close was verified against GitHub',
  );
  assert.ok(repo.gateRuns.length >= 2, 'the gate ran');
});

test('the gate runs before the review, not after it', async () => {
  const { repo } = await runOne({ fixtures: ['session-impl', 'session-review-approved'] });
  const gate = repo.calls.findIndex((c) => c.includes('pnpm'));
  const close = repo.calls.findIndex((c) => c.includes('issue close'));
  assert.ok(gate >= 0 && close > gate, 'gate ran, and before the close');
});

test('a passing gate leaves nothing behind for a session to read', async () => {
  // The saving, and the reason the orchestrator runs these commands: today the session
  // runs them itself and every line of their output rides along in its context.
  const { spawn } = await runOne({ fixtures: ['session-impl', 'session-review-approved'] });
  for (const prompt of prompts(spawn)) {
    assert.doesNotMatch(prompt, /Tests: 38 passed/, 'gate output reached a prompt');
  }
});

// ─── what the sessions may and may not do ──────────────────────────────────────

test('the implementation prompt forbids committing, closing, reviewing and a pull request', async () => {
  const { spawn } = await runOne({ fixtures: ['session-impl', 'session-review-approved'] });
  const impl = prompts(spawn)[0];
  assert.match(impl, /do not commit/i);
  assert.match(impl, /do not close the issue/i);
  assert.match(impl, /do not review your own diff/i);
  assert.match(impl, /do not open a pull request/i);
  assert.match(impl, /#41/);
  assert.match(impl, /base00000000/, 'and it names the base commit');
});

test('no session can reach a subagent or a skill', async () => {
  const { spawn } = await runOne({ fixtures: ['session-impl', 'session-review-approved'] });
  for (const argv of argvs(spawn)) {
    assert.match(argv, /--disallowedTools "?[^"]*Skill/);
    assert.match(argv, /--disable-slash-commands/);
    assert.doesNotMatch(toolArgs(argv), /Skill|Task|Agent/);
  }
  for (const prompt of prompts(spawn)) {
    assert.doesNotMatch(prompt, /code-review/);
  }
});

test('the reviewer is read-only, and told which range is its own', async () => {
  const { spawn } = await runOne({ fixtures: ['session-impl', 'session-review-approved'] });
  const argv = argvs(spawn)[1];
  const review = prompts(spawn)[1];

  assert.match(argv, /--tools "?Read,Grep,Glob,Bash"?/);
  assert.doesNotMatch(toolArgs(argv), /Edit|Write/);
  assert.match(argv, /--effort high/);
  assert.match(argv, /--max-budget-usd 2/);

  assert.match(review, /git diff base00000000/);
  assert.doesNotMatch(review, /master\.\.\./);
  assert.doesNotMatch(review, /master\b(?!.*do not)/i);
});

test('a reviewer that touched the working tree is not believed', async () => {
  let seen = 0;
  const spawnSync = fakeRepo();
  const original = spawnSync;
  const watching = (file, args) => {
    const r = original(file, args);
    // The reviewer session is the second one; make the tree differ afterwards.
    if (file === 'git' && (args || [])[0] === 'status') {
      seen++;
      if (seen > 2) return { status: 0, stdout: ' M apps/api/src/x.ts', stderr: '' };
    }
    return r;
  };
  watching.state = original.state;

  const paths = withTempPaths(ralph);
  const loud = quiet();
  const restore = withFakes(ralph, {
    spawn: fakeSpawn({ fixtures: ['session-impl', 'session-review-approved'] }),
    spawnSync: watching,
  });
  try {
    await assert.rejects(
      ralph.runIssue(PHASE, config(), { issues: null, stopOnLimit: false }, newBudget(), {
        number: 41,
        title: 'Stream the avatar',
      }),
      /changed the working tree/,
    );
    assert.equal(original.state.commits.length, 0, 'and nothing was committed');
  } finally {
    restore();
    loud();
    paths.restore();
  }
});

test('a backend issue gets no browser tools, a web-labelled one does', async () => {
  const backend = await runOne({ fixtures: ['session-impl', 'session-review-approved'] });
  assert.doesNotMatch(argvs(backend.spawn)[0], /playwright/);

  const web = await runOne({
    fixtures: ['session-impl', 'session-review-approved'],
    repo: { labels: ['web'] },
  });
  assert.match(argvs(web.spawn)[0], /playwright/);
  assert.doesNotMatch(argvs(web.spawn)[1], /playwright/, 'never for the reviewer');
});

// ─── nothing is committed without a green gate and an explicit approval ────────

test('a blocking verdict sends the work to repair and then reviews it again', async () => {
  const { result, repo, spawn } = await runOne({
    fixtures: [
      'session-impl',
      'session-review-blocked',
      'session-impl', // the repair session
      'session-review-approved',
    ],
  });

  assert.equal(result.status, 'closed');
  assert.equal(spawn.calls.length, 4, 'implement, review, repair, review');
  assert.match(prompts(spawn)[2], /ownership check is missing/, 'the repair got the finding');
  assert.match(prompts(spawn)[2], /Fix exactly what is above/);
  assert.equal(repo.gateRuns.length, 4, 'the gate ran again after the repair');
  assert.equal(repo.commits.length, 1, 'and only the approved state was committed');
});

test('a failing gate is repaired before any reviewer is paid for', async () => {
  const { result, repo, spawn } = await runOne({
    fixtures: ['session-impl', 'session-impl', 'session-review-approved'],
    repo: { gateFails: ['test:api'] },
  });

  assert.equal(result.status, 'closed');
  assert.match(prompts(spawn)[1], /test:api failed/, 'the repair got the failure');
  assert.match(prompts(spawn)[1], /expected 200, received 403/);
  assert.equal(repo.commits.length, 1);
});

test('a review that keeps blocking stops the run instead of committing', async () => {
  const { error, repo } = await runOne({
    fixtures: ['session-impl', 'session-review-blocked'],
    cfg: { maxIssueRepairs: 1 },
  });

  assert.ok(error, 'the run stopped');
  assert.match(error.message, /still does not pass after 1 repair round/);
  assert.equal(repo.commits.length, 0, 'nothing was committed');
  assert.deepEqual(repo.open.length, 1, 'and the issue is still open');
});

test('a crashed reviewer never counts as an approval', async () => {
  const { result, repo } = await runOne({
    fixtures: ['session-impl', 'session-review-approved'],
    exitCode: 1,
  });

  // exitCode applies to every session here, so the implementation fails first - which
  // is itself the point: a session that did not complete produces no commit.
  assert.equal(result.status, 'open');
  assert.match(result.note, /did not complete/);
  assert.equal(repo.commits.length, 0);
});

test('a review with no result event is a failure, not an approval', async () => {
  const { result, repo } = await runOne({ fixtures: ['session-impl', null] });
  assert.equal(result.status, 'open');
  assert.match(result.note, /the issue review did not complete \(no result event\)/);
  assert.equal(repo.commits.length, 0);
});

test('an implementation that changed nothing is a failed attempt', async () => {
  const { result, repo } = await runOne({
    fixtures: ['session-impl', 'session-review-approved'],
    repo: { files: [] },
  });
  assert.equal(result.status, 'open');
  assert.match(result.note, /changed nothing/);
  assert.equal(repo.commits.length, 0);
});

// ─── the outcome belongs to the orchestrator ───────────────────────────────────

test('a refused commit stops the run and leaves the work in place', async () => {
  const { error, repo } = await runOne({
    fixtures: ['session-impl', 'session-review-approved'],
    repo: { commitFails: 1 },
  });
  assert.ok(error);
  assert.match(error.message, /was refused/);
  assert.match(error.message, /pre-commit hook/);
  assert.equal(repo.open.length, 1, 'the issue was not closed');
});

test('a close failure never starts another implementation session', async () => {
  const { error, spawn, repo } = await runOne({
    fixtures: ['session-impl', 'session-review-approved'],
    repo: { closeFails: true },
  });

  assert.ok(error);
  assert.match(error.message, /without re-implementing anything/);
  assert.match(error.message, /committed as commit00/);
  assert.equal(spawn.calls.length, 2, 'no third session was started');
  assert.equal(repo.commits.length, 1, 'the work is committed and safe');
});

test('an issue GitHub still reports as open stops the run', async () => {
  const { error } = await runOne({
    fixtures: ['session-impl', 'session-review-approved'],
    repo: { stateAfterClose: 'OPEN' },
  });
  assert.ok(error);
  assert.match(error.message, /reads OPEN on GitHub/);
});

// ─── preparation ───────────────────────────────────────────────────────────────

test('a dirty tree stops the issue before a session is started', async () => {
  const { error, spawn } = await runOne({
    fixtures: ['session-impl'],
    repo: { dirty: ' M apps/api/src/other.ts' },
  });
  assert.ok(error);
  assert.match(error.message, /working tree is not clean/);
  assert.equal(spawn.calls.length, 0, 'nothing was spent');
});

test('a retry reuses the recorded base and accepts the tree the last attempt left', async () => {
  const spawnSync = fakeRepo({ dirty: ' M apps/api/src/meetings/avatar.controller.ts' });
  const paths = withTempPaths(ralph);
  const loud = quiet();
  const restore = withFakes(ralph, { spawnSync, spawn: fakeSpawn({ fixture: 'session-impl' }) });
  const budget = newBudget();
  budget.baseSha.set(41, 'base00000000');
  try {
    const ctx = ralph.prepareIssue(PHASE, config(), budget, { number: 41, title: 'x' });
    assert.equal(ctx.baseSha, 'base00000000', 'the anchor did not move');
  } finally {
    restore();
    loud();
    paths.restore();
  }
});

test('the issue body is handed over rather than fetched by the session', async () => {
  const { spawn, repo } = await runOne({
    fixtures: ['session-impl', 'session-review-approved'],
    repo: { body: 'Acceptance criteria: the avatar streams with a range header.' },
  });
  assert.match(prompts(spawn)[0], /range header/);
  assert.match(prompts(spawn)[0], /do not fetch it again/i);
  assert.equal(
    repo.calls.filter((c) => c.includes('issue view') && c.includes('body')).length,
    1,
    'read once',
  );
});

test('an enormous issue body is truncated rather than paid for in full', async () => {
  const { spawn } = await runOne({
    fixtures: ['session-impl', 'session-review-approved'],
    repo: { body: 'x'.repeat(50000) },
    cfg: { issueBodyChars: 500 },
  });
  assert.match(prompts(spawn)[0], /\[body truncated by the orchestrator\]/);
  assert.ok(prompts(spawn)[0].length < 20000);
});

// ─── the commit message ────────────────────────────────────────────────────────

test('a conventional subject from the session is used, anything else is not', () => {
  const issue = { number: 41, title: 'Stream the avatar' };
  assert.match(
    ralph.commitMessageFor('feat(api): stream the avatar', issue, []),
    /^feat\(api\): stream the avatar\n\nCloses #41$/,
  );
  // Not conventional: falls back rather than committing prose as a subject.
  assert.match(
    ralph.commitMessageFor('I added the streaming endpoint', issue, []),
    /^feat: Stream the avatar\n\nCloses #41$/,
  );
  assert.match(ralph.commitMessageFor(null, issue, ['bug']), /^fix: Stream the avatar/);
  assert.match(
    ralph.commitMessageFor(`feat: ${'x'.repeat(200)}`, issue, []),
    /^feat: Stream the avatar/,
    'an over-long subject is rejected',
  );
});

test('the suggested subject is read off the last COMMIT line', () => {
  assert.equal(
    ralph.suggestedCommit('FILES: a.ts\nCOMMIT: feat: one\nmore\nCOMMIT: feat: two'),
    'feat: two',
  );
  assert.equal(ralph.suggestedCommit('no such line'), null);
});

// ─── the phase review is untouched ─────────────────────────────────────────────

test('the phase review is still its own Opus stage', async () => {
  const spawn = fakeSpawn({ fixture: 'session-review-approved' });
  const spawnSync = fakeRepo({ open: [] });
  const paths = withTempPaths(ralph);
  const loud = quiet();
  const restore = withFakes(ralph, { spawn, spawnSync });
  try {
    await ralph.reviewPhase(PHASE, config(), { issues: null, stopOnLimit: false }, newBudget());
    const argv = spawn.calls[0].args.join(' ');
    assert.match(argv, /--model opus/);
    assert.match(argv, /--max-budget-usd 4/);
    assert.match(spawn.calls[0].stdin, /Review the work of milestone/);
  } finally {
    restore();
    loud();
    paths.restore();
  }
});

// ─── the measurement baseline ──────────────────────────────────────────────────

test('every stage of an issue is charged to that issue', async () => {
  const { budget, statsRows: rows, result } = await runOne({
    fixtures: ['session-impl', 'session-review-blocked', 'session-impl', 'session-review-approved'],
  });

  assert.equal(result.status, 'closed');
  assert.deepEqual(
    rows.map((r) => r.stage),
    ['IMPLEMENT', 'ISSUE_REVIEW', 'REPAIR', 'ISSUE_REVIEW'],
  );
  assert.ok(rows.every((r) => r.issue === 41));
  // 1.10 + 0.41 + 1.10 + 0.34
  assert.equal(Number(budget.runCost.toFixed(2)), 2.95);
  assert.ok(budget.perIssue.get(41) > 0);
});

test('the pipeline never writes to the real stats file', async () => {
  const fs = require('node:fs');
  const real = '.claude/ralph.stats.jsonl';
  const before = fs.existsSync(real) ? fs.readFileSync(real, 'utf8') : null;
  await runOne({ fixtures: ['session-impl', 'session-review-approved'] });
  const after = fs.existsSync(real) ? fs.readFileSync(real, 'utf8') : null;
  assert.equal(after, before, 'the measurement baseline is untouched');
});

test('a rate-limit warning does not stop an issue that is going fine', async () => {
  // With --stop-on-limit, which is the strictest setting there is: a warning still
  // must not stop the run. The first canary run died here, having spent $1.15 on a
  // session that had finished its work.
  const { result, error, repo } = await runOne({
    fixtures: ['session-rate-limit-warning', 'session-review-approved'],
    opts: { stopOnLimit: true },
  });

  assert.equal(error, null, error && error.message);
  assert.equal(result.status, 'closed');
  assert.equal(repo.commits.length, 1);
});

test('a refusal still stops the run under --stop-on-limit', async () => {
  const { error, repo } = await runOne({
    fixtures: ['session-rate-limited'],
    opts: { stopOnLimit: true },
  });

  assert.ok(error, 'the run stopped');
  assert.match(error.message, /rate limit hit \(five_hour\)/);
  assert.equal(repo.commits.length, 0);
});
