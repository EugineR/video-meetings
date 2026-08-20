'use strict';

const test = require('node:test');
const assert = require('node:assert');

const ralph = require('../ralph-start.js');
const { replay, fixtureLines } = require('./helpers/stream');

test('parseStreamLine returns null instead of throwing on a malformed line', () => {
  assert.equal(ralph.parseStreamLine('{"type":"assistant","message":{'), null);
  assert.equal(ralph.parseStreamLine('   '), null);
  assert.equal(ralph.parseStreamLine(''), null);
  assert.deepEqual(ralph.parseStreamLine('{"type":"result"}'), { type: 'result' });
});

test('a malformed line in the middle does not lose the events around it', () => {
  const st = replay(ralph, 'session-malformed');
  assert.equal(st.resultText, 'after the broken line');
  assert.equal(st.terminalReason, 'completed');
  // The one well-formed assistant event before the break still counted.
  assert.equal(st.turns, 1);
});

test('applyStreamEvent ignores anything that is not an event object', () => {
  const st = ralph.newSessionStats();
  for (const junk of [null, undefined, 'string', 42]) {
    ralph.applyStreamEvent(st, junk);
  }
  assert.deepEqual(st, ralph.newSessionStats());
});

test('the result event supplies the terminal fields', () => {
  const st = replay(ralph, 'session-completed');
  assert.equal(st.terminalReason, 'completed');
  assert.equal(st.isError, false);
  assert.equal(st.cost, 0.42);
  assert.match(st.resultText, /VERDICT: APPROVED/);
  assert.deepEqual(st.denials, []);
});

test('an earlier terminal reason is not overwritten by the result event', () => {
  const st = ralph.newSessionStats();
  st.terminalReason = 'stalled';
  ralph.applyStreamEvent(st, {
    type: 'result',
    terminal_reason: 'completed',
    result: 'x',
  });
  assert.equal(st.terminalReason, 'stalled');
});

test('a rate limit event is captured for the retry decision', () => {
  const st = replay(ralph, 'session-rate-limited');
  assert.deepEqual(st.rateLimit, {
    status: 'rejected',
    rateLimitType: 'five_hour',
    resetsAt: 1755640800,
  });
  assert.equal(ralph.abortedByRateLimit(st), true);
});

test('permission denials survive to the caller', () => {
  const st = replay(ralph, 'session-denied');
  assert.equal(ralph.deniedTools(st), 'PowerShell');
  // A denial the session worked around must not look like a failure by itself.
  assert.equal(ralph.sessionOutcome({ ...st, exitCode: 0 }), null);
});

test('the last tool use is what the progress line reports', () => {
  const st = replay(ralph, 'session-completed');
  assert.equal(st.lastTool, 'Bash: pnpm test:api');
});

test('a non-string result is not mistaken for a verdict', () => {
  const st = ralph.newSessionStats();
  ralph.applyStreamEvent(st, { type: 'result', result: { text: 'APPROVED' } });
  assert.equal(st.resultText, '');
  assert.equal(ralph.sessionOutcome({ ...st, exitCode: 0 }), 'no result event');
});

test('fixtures cover the shapes the accounting has to survive', () => {
  // A guard on the fixtures themselves: silently losing one of these would make the
  // telemetry tests pass for the wrong reason.
  const completed = fixtureLines('session-completed');
  const ids = completed
    .map((l) => ralph.parseStreamLine(l))
    .filter((e) => e && e.type === 'assistant')
    .map((e) => e.message.id);
  assert.equal(ids.length, 3, 'three assistant events');
  assert.equal(new Set(ids).size, 2, 'two distinct message ids');

  const subagent = fixtureLines('session-subagent')
    .map((l) => ralph.parseStreamLine(l))
    .filter((e) => e && e.parent_tool_use_id);
  assert.equal(subagent.length, 1, 'one forked event');
});
