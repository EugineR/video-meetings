'use strict';

const test = require('node:test');
const assert = require('node:assert');

const ralph = require('../ralph-start.js');
const { replay } = require('./helpers/stream');

const feed = (events) => {
  const st = ralph.newSessionStats();
  for (const ev of events) ralph.applyStreamEvent(st, ev);
  return ralph.finalizeUsage(st);
};

const assistant = (id, usage, extra = {}) => ({
  type: 'assistant',
  message: { id, content: [], usage },
  ...extra,
});

test('repeated events for one message count as a single request', () => {
  // The message is re-emitted as it grows and repeats its running usage each time.
  const st = feed([
    assistant('msg_1', { input_tokens: 100, output_tokens: 10 }),
    assistant('msg_1', { input_tokens: 100, output_tokens: 25 }),
    assistant('msg_1', { input_tokens: 100, output_tokens: 40 }),
  ]);
  assert.equal(st.assistantEvents, 3, 'all three emissions observed');
  assert.equal(st.apiRequests, 1, 'but only one request');
  assert.equal(st.inputTokens, 100, 'input counted once, not three times');
  assert.equal(st.outputTokens, 40, 'the last emission supersedes the earlier ones');
});

test('distinct messages add up', () => {
  const st = feed([
    assistant('msg_1', { input_tokens: 100, output_tokens: 10 }),
    assistant('msg_2', { input_tokens: 50, output_tokens: 5 }),
  ]);
  assert.equal(st.apiRequests, 2);
  assert.equal(st.inputTokens, 150);
  assert.equal(st.outputTokens, 15);
});

test('cache reads never land in inputTokens', () => {
  const st = feed([
    assistant('msg_1', {
      input_tokens: 120,
      cache_creation_input_tokens: 4000,
      cache_read_input_tokens: 30000,
      output_tokens: 45,
    }),
  ]);
  assert.equal(st.inputTokens, 120, 'API input only');
  assert.equal(st.cacheCreationInputTokens, 4000);
  assert.equal(st.cacheReadInputTokens, 30000);
  assert.equal(st.grossInputTokens, 34120, 'the old all-three sum, kept separately');
});

test('the aggregate on the result event wins over the per-event sum', () => {
  const st = feed([
    assistant('msg_1', { input_tokens: 999, output_tokens: 999 }),
    {
      type: 'result',
      num_turns: 7,
      total_cost_usd: 1.25,
      result: 'done',
      usage: {
        input_tokens: 200,
        cache_creation_input_tokens: 4500,
        cache_read_input_tokens: 64000,
        output_tokens: 75,
      },
    },
  ]);
  assert.equal(st.usageQuality, 'result');
  assert.equal(st.inputTokens, 200);
  assert.equal(st.outputTokens, 75);
  assert.equal(st.apiRequests, 7, 'the CLI\'s own turn count, not our event count');
  assert.equal(st.cost, 1.25);
});

test('without a result event the counts fall back to de-duplicated usage', () => {
  const st = feed([
    assistant('msg_1', { input_tokens: 100, output_tokens: 10 }),
    assistant('msg_1', { input_tokens: 100, output_tokens: 30 }),
  ]);
  assert.equal(st.usageQuality, 'deduplicated');
  assert.equal(st.inputTokens, 100);
  assert.equal(st.apiRequests, 1);
});

test('a session with no usage at all reports estimated rather than a fake zero', () => {
  const st = feed([{ type: 'system', subtype: 'init' }]);
  assert.equal(st.usageQuality, 'estimated');
  assert.equal(st.apiRequests, 0);
  assert.equal(st.grossInputTokens, 0);
});

test('a message with no id is still counted', () => {
  // Two id-less messages are two requests; collapsing them would under-report.
  const st = feed([
    assistant(undefined, { input_tokens: 10, output_tokens: 1 }),
    assistant(undefined, { input_tokens: 20, output_tokens: 2 }),
  ]);
  assert.equal(st.apiRequests, 2);
  assert.equal(st.inputTokens, 30);
});

test('subagent events are counted and flagged', () => {
  const st = replay(ralph, 'session-subagent');
  assert.equal(st.forkedEvents, 1, 'the fork is visible in the accounting');
  assert.equal(st.usageQuality, 'result');
  assert.equal(st.cost, 1.1);
});

test('the real fixture reconciles against its own result event', () => {
  const st = replay(ralph, 'session-completed');
  assert.equal(st.assistantEvents, 3);
  assert.equal(st.apiRequests, 2, 'two messages, three emissions');
  assert.equal(st.inputTokens, 200);
  assert.equal(st.cacheCreationInputTokens, 4500);
  assert.equal(st.cacheReadInputTokens, 64000);
  assert.equal(st.grossInputTokens, 68700);
  assert.equal(st.outputTokens, 75);
  assert.equal(st.usageQuality, 'result');
});

test('the old counter would have inflated the same fixture', () => {
  // Guards the regression itself: the pre-fix sum over every assistant event.
  const st = replay(ralph, 'session-completed', { finalize: false });
  const naive = [...st.messages.values(), ...st.anonymousUsage];
  assert.ok(naive.length < st.assistantEvents, 'de-duplication actually removed something');
});

test('currentGrossInput reports de-duplicated gross while the stream is open', () => {
  const st = ralph.newSessionStats();
  ralph.applyStreamEvent(st, assistant('msg_1', { input_tokens: 100 }));
  assert.equal(ralph.currentGrossInput(st), 100);
  ralph.applyStreamEvent(st, assistant('msg_1', { input_tokens: 100 }));
  assert.equal(ralph.currentGrossInput(st), 100, 'not 200');
});

test('buildStatsRow carries the v2 schema and the stage metadata', () => {
  const st = ralph.finalizeUsage(
    (() => {
      const s = ralph.newSessionStats();
      ralph.applyStreamEvent(s, assistant('msg_1', { input_tokens: 10, output_tokens: 2 }));
      ralph.applyStreamEvent(s, {
        type: 'rate_limit_event',
        rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: 42 },
      });
      return s;
    })(),
  );
  st.durationMs = 1000;
  st.exitCode = 0;

  const row = ralph.buildStatsRow('impl', { milestone: 'Phase 4: x' }, 41, st, {
    stage: 'IMPLEMENT',
    model: 'sonnet',
    effort: 'medium',
  });

  assert.equal(row.schemaVersion, 2);
  assert.equal(row.kind, 'impl');
  assert.equal(row.issue, 41);
  assert.equal(row.stage, 'IMPLEMENT');
  assert.equal(row.model, 'sonnet');
  assert.equal(row.effort, 'medium');
  assert.equal(row.inputTokens, 10);
  assert.equal(row.grossInputTokens, 10);
  assert.equal(row.usageQuality, 'deduplicated');
  assert.equal(row.rateLimitType, 'five_hour');
  assert.equal(row.rateLimitResetsAt, 42);
});

test('legacy v1 rows are read, normalised and marked rather than dropped', () => {
  const path = require('node:path');
  const rows = ralph.readStatsRows(
    path.join(__dirname, 'fixtures', 'stats-mixed.jsonl'),
  );
  assert.equal(rows.length, 3, 'the unparseable line is skipped, the rest survive');

  const [v1impl, v1review, v2] = rows;

  assert.equal(v1impl.schemaVersion, 1);
  assert.equal(v1impl.usageQuality, 'estimated', 'v1 numbers double-counted');
  // v1 stored the all-three sum under inputTokens; it becomes gross, and the field
  // that now means "API input only" is blanked rather than left lying about.
  assert.equal(v1impl.grossInputTokens, 4235229);
  assert.equal(v1impl.inputTokens, null);
  assert.equal(v1impl.cacheReadInputTokens, null);
  assert.equal(v1impl.apiRequests, null, 'v1 never knew the request count');
  assert.equal(v1impl.assistantEvents, 75);

  assert.equal(v1review.kind, 'phase-review', 'the old kind name is normalised');

  assert.equal(v2.schemaVersion, 2);
  assert.equal(v2.usageQuality, 'result');
  assert.equal(v2.inputTokens, 2100);
  assert.equal(v2.grossInputTokens, 953100);
});

test('a mixed file never averages a v1 and a v2 token count together', () => {
  const path = require('node:path');
  const rows = ralph.readStatsRows(
    path.join(__dirname, 'fixtures', 'stats-mixed.jsonl'),
  );
  const impl = rows.filter((r) => r.kind === 'impl');
  // Gross is the only quantity both schemas express, so it is the only one an
  // estimate may mix. Everything else must be null on the legacy side.
  assert.ok(impl.every((r) => typeof r.grossInputTokens === 'number'));
  assert.ok(impl.some((r) => r.inputTokens === null));
  assert.ok(impl.some((r) => typeof r.inputTokens === 'number'));
});

test('a missing stats file is empty, not a crash', () => {
  assert.deepEqual(ralph.readStatsRows('.claude/tests/fixtures/does-not-exist.jsonl'), []);
});

const withStats = (fixture, fn) => {
  const path = require('node:path');
  const original = ralph.paths.stats;
  ralph.paths.stats = path.join(__dirname, 'fixtures', fixture);
  try {
    return fn();
  } finally {
    ralph.paths.stats = original;
  }
};

test('the per-issue estimate groups an issue that took several sessions', () => {
  withStats('stats-per-issue.jsonl', () => {
    // Issue 32 cost $1 then $3. Per session the samples are 1, 1, 3, 9 - median 2.
    // Per issue they are 1, 4, 9 - median 4, which is what an issue actually costs.
    const perSession = ralph.estimateCost('impl', 0);
    assert.equal(perSession.samples, 4);
    assert.equal(perSession.usd, 3);

    const perIssue = ralph.estimateCost('impl', 0, { perIssue: true });
    assert.equal(perIssue.samples, 3, 'three issues');
    assert.equal(perIssue.sessions, 4, 'across four sessions');
    assert.equal(perIssue.usd, 4, 'the retry is charged to its issue');
  });
});

test('an estimate falls back to the baseline below three samples', () => {
  withStats('stats-per-issue.jsonl', () => {
    const review = ralph.estimateCost('phase-review', 1.23);
    assert.equal(review.samples, 1);
    assert.equal(review.fromBaseline, true);
    assert.equal(review.usd, 1.23);
  });
});

test('cost estimates may use legacy rows, and say when they do', () => {
  withStats('stats-mixed.jsonl', () => {
    const impl = ralph.estimateCost('impl', 99, { perIssue: true });
    // Only two impl issues in that fixture, so the baseline still wins...
    assert.equal(impl.fromBaseline, true);
    // ...but the rows were readable, which is the point: costUsd is correct in v1 too.
    assert.equal(impl.sessions, 2);
    assert.equal(impl.legacyOnly, false, 'one v1 row and one v2 row');
  });
});

test('median is the middle sample, and empty is null', () => {
  assert.equal(ralph.median([]), null);
  assert.equal(ralph.median([5]), 5);
  assert.equal(ralph.median([9, 1, 4]), 4, 'sorts before picking');
});
