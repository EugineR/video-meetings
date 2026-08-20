'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ralph = require('../ralph-start.js');
const { fakeSpawn, withFakes } = require('./helpers/fake-runtime');

const ORCHESTRATOR = path.join(__dirname, '..', 'ralph-start.js');

const session = (opts) =>
  ralph.runSession({
    model: 'sonnet',
    maxTurns: 100,
    stallSeconds: 120,
    allowedTools: ['Bash', 'Read'],
    prompt: 'do the thing',
    ...opts,
  });

test('requiring the orchestrator starts nothing and prints nothing', () => {
  // The real guarantee, in a fresh process: an import that parsed argv or reached for
  // GitHub would show up here as output or a non-zero exit.
  const out = execFileSync(
    process.execPath,
    ['-e', `require(${JSON.stringify(ORCHESTRATOR)}); process.stdout.write('INERT');`],
    { encoding: 'utf8' },
  );
  assert.equal(out, 'INERT');
});

test('runSession replays a completed session into stats', async () => {
  const spawn = fakeSpawn({ fixture: 'session-completed' });
  const restore = withFakes(ralph, { spawn });
  try {
    const st = await session();
    assert.equal(st.terminalReason, 'completed');
    assert.equal(st.exitCode, 0);
    assert.equal(st.cost, 0.42);
    assert.match(st.resultText, /VERDICT: APPROVED/);
    assert.ok(st.durationMs >= 0);
  } finally {
    restore();
  }
});

test('a line split across chunks is not lost or double counted', async () => {
  // A pipe does not respect line boundaries; the buffering in runSession has to.
  const perLine = fakeSpawn({ fixture: 'session-completed' });
  const restoreA = withFakes(ralph, { spawn: perLine });
  let whole;
  try {
    whole = await session();
  } finally {
    restoreA();
  }

  const chopped = fakeSpawn({ fixture: 'session-completed', delivery: 7 });
  const restoreB = withFakes(ralph, { spawn: chopped });
  try {
    const split = await session();
    assert.equal(split.turns, whole.turns);
    assert.equal(split.inputTokens, whole.inputTokens);
    assert.equal(split.outputTokens, whole.outputTokens);
    assert.equal(split.resultText, whole.resultText);
    assert.equal(split.cost, whole.cost);
  } finally {
    restoreB();
  }
});

test('runSession passes the model, turn cap and tool list to the CLI', async () => {
  const spawn = fakeSpawn({ fixture: 'session-completed' });
  const restore = withFakes(ralph, { spawn });
  try {
    await session({ model: 'opus', allowedTools: ['Read', 'Grep'] });
    const argv = spawn.calls[0].args.join(' ');
    assert.match(argv, /--model opus/);
    assert.match(argv, /--max-turns 100/);
    assert.match(argv, /--output-format stream-json/);
    assert.match(argv, /--allowedTools Read Grep/);
    // The prompt goes over stdin, never on the command line.
    assert.doesNotMatch(argv, /do the thing/);
  } finally {
    restore();
  }
});

test('a non-zero exit is reported rather than swallowed', async () => {
  const spawn = fakeSpawn({ fixture: 'session-rate-limited', exitCode: 1 });
  const restore = withFakes(ralph, { spawn });
  try {
    const st = await session();
    assert.equal(st.exitCode, 1);
    assert.equal(ralph.abortedByRateLimit(st), true);
    assert.match(ralph.sessionOutcome(st), /exit code 1/);
  } finally {
    restore();
  }
});

test('a session that produced no result event never reads as success', async () => {
  const spawn = fakeSpawn({ fixture: null, exitCode: 0 });
  const restore = withFakes(ralph, { spawn });
  try {
    const st = await session();
    assert.equal(st.resultText, '');
    assert.equal(ralph.sessionOutcome(st), 'no result event');
  } finally {
    restore();
  }
});
