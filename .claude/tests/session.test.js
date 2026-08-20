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
    assert.equal(split.assistantEvents, whole.assistantEvents);
    assert.equal(split.apiRequests, whole.apiRequests);
    assert.equal(split.inputTokens, whole.inputTokens);
    assert.equal(split.cacheReadInputTokens, whole.cacheReadInputTokens);
    assert.equal(split.grossInputTokens, whole.grossInputTokens);
    assert.equal(split.outputTokens, whole.outputTokens);
    assert.equal(split.resultText, whole.resultText);
    assert.equal(split.cost, whole.cost);
    // Guards against both halves being undefined and the test passing vacuously.
    assert.ok(whole.grossInputTokens > 0, 'fixture carries usage');
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
    assert.match(argv, /--exclude-dynamic-system-prompt-sections/);
    // The prompt goes over stdin, never on the command line.
    assert.doesNotMatch(argv, /do the thing/);
  } finally {
    restore();
  }
});

test('runSession passes the stage effort and the cost cap', async () => {
  const spawn = fakeSpawn({ fixture: 'session-completed' });
  const restore = withFakes(ralph, { spawn });
  try {
    await session({ effort: 'high', maxCostUsd: 4 });
    const argv = spawn.calls[0].args.join(' ');
    assert.match(argv, /--effort high/);
    assert.match(argv, /--max-budget-usd 4/);
  } finally {
    restore();
  }
});

test('effort and the cost cap are omitted rather than passed empty', async () => {
  const spawn = fakeSpawn({ fixture: 'session-completed' });
  const restore = withFakes(ralph, { spawn });
  try {
    await session({ effort: undefined, maxCostUsd: undefined });
    const argv = spawn.calls[0].args.join(' ');
    assert.doesNotMatch(argv, /--effort/);
    assert.doesNotMatch(argv, /--max-budget-usd/);
  } finally {
    restore();
  }
});

test('runSession can limit the built-in tool set and disable skills', async () => {
  const spawn = fakeSpawn({ fixture: 'session-completed' });
  const restore = withFakes(ralph, { spawn });
  try {
    await session({
      tools: ['Read', 'Grep', 'Glob', 'Bash'],
      disallowedTools: ['Task', 'Skill'],
      disableSlashCommands: true,
    });
    const flat = spawn.calls[0].args.join(' ');
    // Comma-joined, so each variadic flag consumes exactly one argument. On Windows
    // the shim quotes it, which is the same single argument once cmd.exe has parsed it.
    assert.match(flat, /--tools "?Read,Grep,Glob,Bash"?/);
    assert.match(flat, /--disallowedTools "?Task,Skill"?/);
    assert.match(flat, /--disable-slash-commands/);
    assert.equal((flat.match(/--tools/g) || []).length, 1, 'the list is one argument');
  } finally {
    restore();
  }
});

test('an unrestricted session passes no tool-limiting flag at all', async () => {
  const spawn = fakeSpawn({ fixture: 'session-completed' });
  const restore = withFakes(ralph, { spawn });
  try {
    await session({ tools: [], disallowedTools: [], disableSlashCommands: false });
    const flat = spawn.calls[0].args.join(' ');
    assert.doesNotMatch(flat, /--tools/);
    assert.doesNotMatch(flat, /--disallowedTools/);
    assert.doesNotMatch(flat, /--disable-slash-commands/);
  } finally {
    restore();
  }
});

test('--allowedTools stays last, because it is variadic', async () => {
  // Anything after it would be read as another tool name and silently swallowed.
  const spawn = fakeSpawn({ fixture: 'session-completed' });
  const restore = withFakes(ralph, { spawn });
  try {
    await session({
      effort: 'high',
      maxCostUsd: 4,
      tools: ['Read', 'Grep', 'Bash'],
      disallowedTools: ['Task', 'Skill'],
      disableSlashCommands: true,
      allowedTools: ['Read', 'Grep', 'Bash'],
    });
    const argv = spawn.calls[0].args;
    const flat = argv.join(' ');
    const at = flat.indexOf('--allowedTools');
    assert.ok(at >= 0);
    const tail = flat.slice(at + '--allowedTools'.length);
    assert.doesNotMatch(tail, /--/, `a flag follows --allowedTools: ${tail}`);
    assert.ok(flat.trimEnd().endsWith('Bash'), flat);
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
