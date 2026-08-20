'use strict';

/**
 * Reading recorded stream-json sessions back into the orchestrator's accounting.
 *
 * The fixtures under ../fixtures are real event shapes, not simplified ones: the
 * arithmetic that broke in production broke on details (an id repeated across two
 * events, usage present on both an assistant event and the final result), so a
 * fixture that smoothed those away would test nothing.
 */

const fs = require('fs');
const path = require('path');

const FIXTURES = path.join(__dirname, '..', 'fixtures');

/** Raw lines of a fixture, blank ones dropped but malformed ones kept. */
function fixtureLines(name) {
  const file = path.join(FIXTURES, name.endsWith('.jsonl') ? name : name + '.jsonl');
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '');
}

/**
 * Folds a whole fixture through the orchestrator's own parser and returns the stats it
 * ends up with - the same path runSession takes, minus the child process. Finalised by
 * default, because a fixture stands for a session that ended; pass finalize: false to
 * inspect the accumulator mid-stream.
 */
function replay(ralph, name, { finalize = true } = {}) {
  const st = ralph.newSessionStats();
  for (const line of fixtureLines(name)) {
    const ev = ralph.parseStreamLine(line);
    if (ev) ralph.applyStreamEvent(st, ev);
  }
  return finalize ? ralph.finalizeUsage(st) : st;
}

/**
 * Splits a fixture into byte chunks that cut lines in half, the way a pipe delivers
 * them. Used to prove the line buffering does not lose or duplicate an event.
 */
function chunked(name, size = 40) {
  const text = fixtureLines(name).join('\n') + '\n';
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

module.exports = { FIXTURES, fixtureLines, replay, chunked };
