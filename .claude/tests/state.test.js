'use strict';

/**
 * The durable checkpoint and what it is for: never doing the same work twice.
 *
 * Every test here drives the pipeline through the fake runtime, stops it somewhere, and
 * starts it again over the same checkpoint - which is the only way to show that a
 * resume resumes rather than restarts. A run that repeats an issue after a rate limit
 * costs real money; issue #39 cost $1.83 and was thrown away in full.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const ralph = require('../ralph-start.js');
const { fakeSpawn, withFakes } = require('./helpers/fake-runtime');
const { fakeRepo, withTempPaths, quiet } = require('./helpers/fake-repo');

const PHASE = {
  index: 4,
  milestone: 'Phase 4: Avatar streaming',
  branch: 'feature/user-profile-phase-4',
};
const OPTS = { issues: null, stopOnLimit: false };
const ISSUE = { number: 41, title: 'Stream the avatar' };
const LEFTOVERS = ' M apps/api/src/meetings/avatar.controller.ts';

const config = (over) => ({
  ...ralph.loadConfig('.claude/ralph.config.json'),
  // `stop` is what a rate limit does by default now, and it is also what makes the
  // resume observable: the run ends, the checkpoint stays, the next run picks it up.
  onRateLimit: 'stop',
  issueGate: [{ name: 'test:api', run: ['pnpm', 'test:api'], when: 'apps/api/' }],
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
  rateLimitWaits: 0,
  done: new Set(),
});

/**
 * A loop that can be stopped and started again: one checkpoint directory and one
 * in-memory repository, shared by as many `run()` calls as a test needs. Each `run()`
 * stands for one process - a fresh budget, a fresh set of sessions, the same checkpoint.
 */
function loop({ repo = {}, cfg = {} } = {}) {
  const paths = withTempPaths(ralph);
  const spawnSync = fakeRepo(repo);
  const loud = quiet();
  const conf = config(cfg);

  return {
    repo: spawnSync.state,
    async run({ fixtures, exitCode = 0, sleep } = {}) {
      const spawn = fakeSpawn({ fixtures, exitCode });
      const budget = newBudget();
      // runPhase seeds this from the checkpoint before it drains issues; runIssue is
      // called directly here, so the same seeding happens here.
      const saved = ralph.readState();
      if (saved && saved.issue && saved.issueBaseSha) {
        budget.baseSha.set(saved.issue, saved.issueBaseSha);
      }
      const restore = withFakes(ralph, {
        spawn,
        spawnSync,
        sleep: sleep || (async () => {}),
      });
      const out = { spawn, budget, result: null, error: null };
      try {
        out.result = await ralph.runIssue(
          PHASE,
          conf,
          OPTS,
          budget,
          spawnSync.state.open[0] || ISSUE,
        );
      } catch (err) {
        out.error = err;
      } finally {
        restore();
      }
      return out;
    },
    stopFile: () => ralph.paths.stop,
    state: () =>
      fs.existsSync(ralph.paths.state)
        ? JSON.parse(fs.readFileSync(ralph.paths.state, 'utf8'))
        : null,
    end() {
      loud();
      paths.restore();
    },
  };
}

// ─── the checkpoint itself ─────────────────────────────────────────────────────

test('the checkpoint is written atomically and reads back', () => {
  const paths = withTempPaths(ralph);
  try {
    assert.equal(ralph.readState(), null, 'no file is no checkpoint, not an error');

    ralph.writeState({
      feature: 'user-profile-page-and-editing',
      phase: 4,
      milestone: PHASE.milestone,
      branch: PHASE.branch,
      issue: 41,
      issueBaseSha: 'base00000000',
      stage: 'ISSUE_REVIEW',
      reviewRound: 1,
      commitSha: null,
    });

    assert.equal(
      fs.existsSync(`${ralph.paths.state}.tmp`),
      false,
      'the temporary file was renamed, not left lying around',
    );
    const read = ralph.readState();
    assert.equal(read.schemaVersion, ralph.STATE_SCHEMA_VERSION);
    assert.equal(read.stage, 'ISSUE_REVIEW');
    assert.equal(read.issueBaseSha, 'base00000000');
    assert.ok(Date.parse(read.updatedAt) > 0, 'and it is stamped');
  } finally {
    paths.restore();
  }
});

test('the checkpoint is gitignored and the stale iterations entry is gone', () => {
  const ignore = fs.readFileSync('.gitignore', 'utf8');
  assert.match(ignore, /^\.claude\/ralph\.state\.json$/m);
  assert.doesNotMatch(ignore, /ralph\.iterations\.json/);
});

test('a checkpoint that cannot be trusted stops the loop with a clear error', () => {
  const paths = withTempPaths(ralph);
  try {
    const cases = [
      ['not json at all', /not valid JSON/],
      ['[]', /not a checkpoint object/],
      [
        JSON.stringify({ schemaVersion: 99, feature: 'f', branch: 'b', stage: 'IMPLEMENT' }),
        /schemaVersion 99/,
      ],
      [JSON.stringify({ schemaVersion: 1, branch: 'b', stage: 'IMPLEMENT' }), /has no feature/],
      [
        JSON.stringify({ schemaVersion: 1, feature: 'f', branch: 'b', stage: 'FLYING' }),
        /unknown stage "FLYING"/,
      ],
    ];
    for (const [text, expected] of cases) {
      fs.writeFileSync(ralph.paths.state, text);
      assert.throws(() => ralph.readState(), expected, text.slice(0, 30));
      // Every one of them has to say what to do about it, not just what is wrong.
      assert.throws(() => ralph.readState(), /delete it to start the issue over/);
    }
  } finally {
    paths.restore();
  }
});

// ─── the startup guard ─────────────────────────────────────────────────────────

test('a dirty tree with no checkpoint stops the loop', () => {
  assert.equal(ralph.startupTreeRefusal(null, ''), null, 'a clean tree always starts');
  const refusal = ralph.startupTreeRefusal(null, LEFTOVERS);
  assert.match(refusal, /Working tree is not clean/);
  assert.match(refusal, /no checkpoint/);
  assert.match(refusal, /avatar\.controller\.ts/, 'and it says what is in the way');
});

test('a checkpoint excuses dirt only at a stage that leaves work in the tree', () => {
  for (const stage of ['IMPLEMENT', 'ISSUE_GATE', 'ISSUE_REVIEW', 'REPAIR', 'COMMIT']) {
    assert.equal(ralph.startupTreeRefusal({ stage }, LEFTOVERS), null, stage);
  }
  // Past the commit the work is in git, and a phase review never writes: dirt at those
  // stages belongs to somebody else and is not this loop's to sweep up.
  for (const stage of ['PREPARE', 'CLOSE_ISSUE', 'VERIFY_CLOSED', 'PHASE_REVIEW']) {
    assert.match(
      ralph.startupTreeRefusal({ stage }, LEFTOVERS),
      /leaves a clean tree/,
      stage,
    );
  }
});

// ─── resuming the exact stage ──────────────────────────────────────────────────

test('a rate limit during the implementation resumes at IMPLEMENT', async () => {
  const l = loop();
  try {
    const first = await l.run({ fixtures: ['session-rate-limited'] });
    assert.match(first.error.message, /rate limit hit/);
    assert.equal(l.state().stage, 'IMPLEMENT');
    assert.equal(l.state().issueBaseSha, 'base00000000');
    assert.equal(l.state().issue, 41);

    l.repo.dirty = LEFTOVERS; // the half-finished attempt is still in the tree
    const second = await l.run({ fixtures: ['session-impl', 'session-review-approved'] });
    assert.equal(second.result.status, 'closed');
    assert.equal(second.spawn.calls.length, 2, 'implementation and review, nothing more');
    assert.equal(l.state(), null, 'and the checkpoint is gone');
  } finally {
    l.end();
  }
});

test('a rate limit during the review repeats the review only', async () => {
  const l = loop();
  try {
    const first = await l.run({ fixtures: ['session-impl', 'session-rate-limited'] });
    assert.match(first.error.message, /rate limit hit/);
    assert.equal(l.state().stage, 'ISSUE_REVIEW');
    assert.equal(l.state().reviewRound, 1);

    l.repo.dirty = LEFTOVERS;
    const gateBefore = l.repo.gateRuns.length;
    const second = await l.run({ fixtures: ['session-review-approved'] });

    assert.equal(second.result.status, 'closed');
    assert.equal(second.spawn.calls.length, 1, 'the implementation was not repeated');
    assert.match(
      second.spawn.calls[0].args.join(' '),
      /--tools "?Read,Grep,Glob,Bash/,
      'and the one session that ran was the reviewer',
    );
    assert.equal(
      l.repo.gateRuns.length,
      gateBefore,
      'the gate was green at the checkpoint, so it did not run again either',
    );
  } finally {
    l.end();
  }
});

test('a rate limit during a repair does not send the issue back to implementation', async () => {
  const l = loop();
  try {
    const first = await l.run({
      fixtures: ['session-impl', 'session-review-blocked', 'session-rate-limited'],
    });
    assert.match(first.error.message, /rate limit hit/);
    assert.equal(l.state().stage, 'REPAIR');

    l.repo.dirty = LEFTOVERS;
    const gateBefore = l.repo.gateRuns.length;
    const second = await l.run({ fixtures: ['session-review-approved'] });

    assert.equal(second.result.status, 'closed');
    assert.equal(second.spawn.calls.length, 1, 'only the review, no fresh implementation');
    assert.ok(
      l.repo.gateRuns.length > gateBefore,
      'the gate runs again after a repair - it is deterministic and costs no session',
    );
  } finally {
    l.end();
  }
});

test('a resumed issue still commits the subject its session suggested', async () => {
  const l = loop();
  try {
    await l.run({ fixtures: ['session-impl', 'session-rate-limited'] });
    assert.match(l.state().commitSubject, /^feat\(api\)/);

    l.repo.dirty = LEFTOVERS;
    await l.run({ fixtures: ['session-review-approved'] });
    assert.match(l.repo.commits[0], /^feat\(api\): stream the profile avatar\n\nCloses #41$/);
  } finally {
    l.end();
  }
});

test('a checkpoint whose work is no longer in the tree implements again', async () => {
  const l = loop();
  try {
    await l.run({ fixtures: ['session-impl', 'session-rate-limited'] });
    assert.equal(l.state().stage, 'ISSUE_REVIEW');

    // Somebody read the leftovers and threw them away, which is exactly what the stop
    // message tells them they may do. Reviewing nothing would be worse than redoing it.
    l.repo.files = [];
    const second = await l.run({ fixtures: ['session-impl', 'session-review-approved'] });
    assert.equal(second.spawn.calls.length, 1, 'the implementation session ran again');
    assert.match(second.result.note, /changed nothing/);
  } finally {
    l.end();
  }
});

test('a checkpoint that disagrees with HEAD stops instead of guessing', async () => {
  const l = loop();
  try {
    await l.run({ fixtures: ['session-impl', 'session-rate-limited'] });
    l.repo.head = 'moved0000000';

    const second = await l.run({ fixtures: ['session-review-approved'] });
    assert.match(second.error.message, /expects feature\/user-profile-phase-4 at base0000/);
    assert.match(second.error.message, /but HEAD is moved000/);
    assert.equal(second.spawn.calls.length, 0, 'and nothing was spent finding out');
  } finally {
    l.end();
  }
});

// ─── the outcome half ──────────────────────────────────────────────────────────

test('a commit whose close failed is closed on the next run, with no model session', async () => {
  const l = loop({ repo: { closeFails: true } });
  try {
    const first = await l.run({ fixtures: ['session-impl', 'session-review-approved'] });
    assert.match(first.error.message, /closing it failed/);
    assert.equal(l.repo.commits.length, 1);
    assert.equal(l.state().stage, 'CLOSE_ISSUE');
    assert.equal(l.state().commitSha, 'commit000001');

    l.repo.closeFails = false;
    const second = await l.run({ fixtures: ['session-impl', 'session-review-approved'] });

    assert.equal(second.spawn.calls.length, 0, 'not one session was started');
    assert.equal(second.result.status, 'closed');
    assert.equal(l.repo.commits.length, 1, 'and nothing was committed twice');
    assert.deepEqual(l.repo.open, []);
    assert.equal(l.state(), null);
  } finally {
    l.end();
  }
});

test('an issue closed by hand while the loop was down needs no work at all', async () => {
  const l = loop({ repo: { closeFails: true } });
  try {
    await l.run({ fixtures: ['session-impl', 'session-review-approved'] });
    assert.equal(l.state().stage, 'CLOSE_ISSUE');

    // Closed on GitHub by a human. The list and the single-issue read are separate
    // things in the fake because they are separate things in GitHub - the list lags.
    l.repo.closed.add(41);
    l.repo.open = [];
    const second = await l.run({ fixtures: ['session-impl'] });

    assert.equal(second.spawn.calls.length, 0);
    assert.equal(second.result.status, 'closed');
    assert.match(second.result.note, /already committed/);
    assert.equal(l.state(), null);
  } finally {
    l.end();
  }
});

test('the checkpoint is cleared only once GitHub confirms the close', async () => {
  const verified = loop();
  try {
    const r = await verified.run({ fixtures: ['session-impl', 'session-review-approved'] });
    assert.equal(r.result.status, 'closed');
    assert.equal(verified.state(), null, 'a verified close clears it');
  } finally {
    verified.end();
  }

  const unverified = loop({ repo: { stateAfterClose: 'OPEN' } });
  try {
    const r = await unverified.run({ fixtures: ['session-impl', 'session-review-approved'] });
    assert.match(r.error.message, /reads OPEN on GitHub/);
    assert.equal(unverified.state().stage, 'VERIFY_CLOSED');
    assert.equal(unverified.state().commitSha, 'commit000001');
  } finally {
    unverified.end();
  }

  const blocked = loop({ cfg: { maxIssueRepairs: 0 } });
  try {
    const r = await blocked.run({ fixtures: ['session-impl', 'session-review-blocked'] });
    assert.match(r.error.message, /still does not pass/);
    assert.equal(blocked.state().stage, 'ISSUE_REVIEW', 'a blocked issue keeps its place');
  } finally {
    blocked.end();
  }
});

test('a checkpoint survives an interrupt as a checkpoint the next run accepts', async () => {
  const l = loop();
  try {
    // The stop file is the same door Ctrl-C uses - checkInterrupt honours both, and it
    // is the one a test can push without signalling the test runner's own process.
    fs.writeFileSync(l.stopFile(), '');
    const first = await l.run({ fixtures: ['session-impl'] });
    assert.match(first.error.message, /stopping/);
    assert.equal(first.spawn.calls.length, 1, 'the session it was in the middle of finished');

    const saved = ralph.readState();
    assert.equal(saved.stage, 'IMPLEMENT');
    assert.equal(saved.issue, 41);
    assert.equal(saved.branch, PHASE.branch);

    fs.rmSync(l.stopFile());
    l.repo.dirty = LEFTOVERS;
    const second = await l.run({ fixtures: ['session-impl', 'session-review-approved'] });
    assert.equal(second.result.status, 'closed');
  } finally {
    l.end();
  }
});

// ─── the phase review, which had no rate-limit branch at all ───────────────────

function phaseReview({ fixtures, cfg = {} }) {
  const spawn = fakeSpawn({ fixtures });
  const spawnSync = fakeRepo({ open: [] });
  const paths = withTempPaths(ralph);
  const loud = quiet();
  const waits = [];
  const restore = withFakes(ralph, {
    spawn,
    spawnSync,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  const budget = newBudget();
  return {
    spawn,
    waits,
    budget,
    conf: config({ onRateLimit: 'wait', ...cfg }),
    end() {
      restore();
      loud();
      paths.restore();
    },
  };
}

test('a rate-limited phase review repeats the review instead of ending the run', async () => {
  // Before this, handleRateLimit waited and the rate-limited session then failed
  // sessionOutcome and threw, discarding every issue the phase had already finished.
  const h = phaseReview({
    fixtures: ['session-rate-limited', 'session-review-approved'],
    // One round: if the limit had cost a review round the second review could not run.
    cfg: { maxReviewRounds: 1 },
  });
  try {
    await ralph.reviewPhase(PHASE, h.conf, OPTS, h.budget);
    assert.equal(h.spawn.calls.length, 2, 'the review ran again after the reset');
    assert.equal(h.waits.length, 1, 'having waited for exactly one reset');
    assert.equal(h.budget.rateLimitWaits, 1, 'and the wait was counted');
  } finally {
    h.end();
  }
});

test('the phase review gives up after maxRateLimitRetries limits', async () => {
  const h = phaseReview({
    fixtures: ['session-rate-limited'],
    cfg: { maxReviewRounds: 9, maxRateLimitRetries: 2, maxRateLimitWaits: 99 },
  });
  try {
    await assert.rejects(
      ralph.reviewPhase(PHASE, h.conf, OPTS, h.budget),
      /was cut off by the rate limit 3 times/,
    );
  } finally {
    h.end();
  }
});

test('the number of rate-limit waits in one run is capped', async () => {
  const h = phaseReview({
    fixtures: ['session-rate-limited'],
    cfg: { maxReviewRounds: 9, maxRateLimitRetries: 9, maxRateLimitWaits: 2 },
  });
  try {
    await assert.rejects(
      ralph.reviewPhase(PHASE, h.conf, OPTS, h.budget),
      /already waited out 2 rate-limit reset/,
    );
    assert.equal(h.waits.length, 2, 'it waited twice and refused a third time');
    assert.equal(h.spawn.calls.length, 3);
  } finally {
    h.end();
  }
});

test('a rate limit stops the run when the config says stop, and says the resume is safe', async () => {
  const h = phaseReview({ fixtures: ['session-rate-limited'], cfg: { onRateLimit: 'stop' } });
  try {
    await assert.rejects(
      ralph.reviewPhase(PHASE, h.conf, OPTS, h.budget),
      /stopping as configured - re-run once it clears/,
    );
    assert.equal(h.waits.length, 0);
  } finally {
    h.end();
  }
});

test('stop is what a config that says nothing gets', () => {
  const paths = withTempPaths(ralph);
  const loud = quiet();
  const file = `${ralph.paths.state}.config.json`;
  try {
    fs.writeFileSync(
      file,
      JSON.stringify({
        feature: 'f',
        featureBranch: 'feature/f',
        implPrompt: 'x',
        issueReviewPrompt: 'x',
        repairPrompt: 'x',
        reviewPrompt: 'x',
      }),
    );
    const bare = ralph.loadConfig(file);
    // Stopping is only cheap because the checkpoint resumes the exact stage, so a
    // config that has not thought about it gets the answer that cannot lose work.
    assert.equal(bare.onRateLimit, 'stop');
    assert.equal(bare.maxRateLimitWaits, 4);

    // The repository's own config opts into waiting, deliberately, for unattended runs.
    assert.equal(ralph.loadConfig('.claude/ralph.config.json').onRateLimit, 'wait');
  } finally {
    loud();
    paths.restore();
  }
});

// ─── the measurement baseline ──────────────────────────────────────────────────

test('no test ever leaves a checkpoint in the repository', async () => {
  const real = '.claude/ralph.state.json';
  const before = fs.existsSync(real);
  const l = loop();
  try {
    await l.run({ fixtures: ['session-impl', 'session-review-approved'] });
  } finally {
    l.end();
  }
  assert.equal(fs.existsSync(real), before, 'the repository checkout is untouched');
  assert.equal(fs.existsSync(`${real}.tmp`), false);
});

// ─── the branch a resume may start from ────────────────────────────────────────

const CHECKPOINT = { branch: 'feature/user-profile-phase-4', stage: 'ISSUE_REVIEW', issue: 41 };

test('the trunk is always a valid place to start', () => {
  assert.equal(ralph.startupBranchRefusal('master', 'master', null, []), null);
  assert.equal(ralph.startupBranchRefusal('master', 'master', CHECKPOINT, ['x']), null);
});

test('without a checkpoint a phase branch is still refused', () => {
  // The original guard, unchanged: a finished run leaves the tree on a phase branch,
  // and starting there would execute that branch's own older copy of the loop.
  const refusal = ralph.startupBranchRefusal('feature/user-profile-phase-4', 'master', null, []);
  assert.match(refusal, /Start the loop from master/);
  assert.match(refusal, /that branch's copy of the orchestrator/);
});

test('a resume may start from the branch its own checkpoint names', () => {
  // Why this exception has to exist: the interrupted issue's work is uncommitted on the
  // phase branch, and git will not carry a file the trunk does not have back to the
  // trunk. The canary stood at ISSUE_REVIEW with no way back except stashing away the
  // very work the checkpoint was protecting.
  assert.equal(
    ralph.startupBranchRefusal('feature/user-profile-phase-4', 'master', CHECKPOINT, []),
    null,
  );
});

test('a resume is refused from a branch the checkpoint does not name', () => {
  const refusal = ralph.startupBranchRefusal('feature/other-phase-2', 'master', CHECKPOINT, []);
  assert.match(refusal, /belongs to feature\/user-profile-phase-4/);
});

test('a branch running its own copy of the loop is refused, and told what to do', () => {
  const refusal = ralph.startupBranchRefusal(
    'feature/user-profile-phase-4',
    'master',
    CHECKPOINT,
    ['.claude/ralph-start.js'],
  );
  assert.match(refusal, /its own version of \.claude\/ralph-start\.js/);
  assert.match(refusal, /Merge master into feature\/user-profile-phase-4 first/);
});

test('orchestratorDrift compares the files behaviour comes out of', () => {
  // Against the real repository: HEAD and origin/master agree here, or the working
  // branch is deliberately ahead - either way the answer must be a list, not a throw.
  const drift = ralph.orchestratorDrift('master');
  assert.ok(Array.isArray(drift));
  for (const file of drift) assert.ok(ralph.ORCHESTRATOR_FILES.includes(file), file);
});

// ─── a resume must not move the ground under itself ────────────────────────────

test('a checkpoint counts only while it has something at stake', () => {
  const mid = { issue: 41, stage: 'ISSUE_REVIEW', commitSha: null };
  assert.equal(ralph.checkpointAtStake(mid, LEFTOVERS), true, 'work in the tree');
  assert.equal(ralph.checkpointAtStake(mid, ''), false, 'nothing left of it');
  // A commit is at stake even with a clean tree: the issue still has to be closed.
  assert.equal(
    ralph.checkpointAtStake({ issue: 41, stage: 'CLOSE_ISSUE', commitSha: 'abc' }, ''),
    true,
  );
  assert.equal(ralph.checkpointAtStake(null, LEFTOVERS), false);
  assert.equal(ralph.checkpointAtStake({ stage: 'PHASE_REVIEW' }, LEFTOVERS), false);
});

/** Runs one phase far enough to see how it prepared the branches, then lets it stop. */
async function phaseUpToDrain({ state, repo = {} }) {
  const spawnSync = fakeRepo({ dirty: state ? LEFTOVERS : '', ...repo });
  const paths = withTempPaths(ralph);
  const loud = quiet();
  const restore = withFakes(ralph, {
    spawnSync,
    spawn: fakeSpawn({ fixtures: ['session-impl', 'session-review-approved'] }),
  });
  if (state) fs.writeFileSync(paths.state, JSON.stringify(state));
  try {
    // --issues 0 stops it inside drainIssues, after the branch preparation under test.
    await ralph
      .runPhase(PHASE, config(), { issues: 0, stopOnLimit: false }, 'master', newBudget())
      .catch(() => {});
    return spawnSync.state;
  } finally {
    restore();
    loud();
    paths.restore();
  }
}

const checkpointFor = (over) => ({
  schemaVersion: 1,
  feature: ralph.loadConfig('.claude/ralph.config.json').feature,
  phase: PHASE.index,
  milestone: PHASE.milestone,
  branch: PHASE.branch,
  issue: 41,
  issueBaseSha: 'base00000000',
  stage: 'ISSUE_REVIEW',
  reviewRound: null,
  commitSha: null,
  commitSubject: null,
  updatedAt: '2026-08-20T18:00:00.000Z',
  ...over,
});

test('a phase resumed mid-issue does not merge the trunk in', async () => {
  // The merges belong to the start of a phase. Run under an interrupted issue they move
  // HEAD out from under the anchor the checkpoint measured that issue from, and the
  // resume then refuses itself - which is what the canary hit twice.
  const repo = await phaseUpToDrain({ state: checkpointFor() });
  assert.deepEqual(repo.merges, [], `merged anyway: ${repo.merges.join(' | ')}`);
});

test('a phase with no live checkpoint prepares its branches as usual', async () => {
  const repo = await phaseUpToDrain({ state: null });
  assert.ok(repo.merges.length > 0, 'the trunk was never merged in');
});

test('a checkpoint with nothing left in the tree does not hold the phase back', async () => {
  // Same checkpoint, empty tree: the phase must start normally rather than pin an
  // anchor that no longer describes anything.
  const repo = await phaseUpToDrain({ state: checkpointFor(), repo: { dirty: '' } });
  assert.ok(repo.merges.length > 0, 'a spent checkpoint still blocked the merge');
});
