'use strict';

/**
 * Fakes for the orchestrator's only door to the outside world.
 *
 * Every test that touches git, gh, pnpm or claude installs these. Nothing here ever
 * runs a real process, so the suite cannot accidentally spend money, mutate the
 * repository or need a GitHub login - see plan.md's constraints.
 */

const { EventEmitter } = require('events');
const { Readable } = require('stream');
const { fixtureLines } = require('./stream');

/**
 * A spawnSync stand-in driven by a list of {match, stdout, status} rules. `match` is a
 * substring of the full "file arg arg" command line; the first matching rule wins, and
 * an unmatched command is a test failure rather than a silent empty result - a typo in
 * a rule would otherwise look like a passing test.
 */
function fakeSpawnSync(rules) {
  const calls = [];
  const fn = (file, args) => {
    const line = [file, ...(args || [])].join(' ');
    calls.push(line);
    const rule = rules.find((r) => line.includes(r.match));
    if (!rule) {
      throw new Error(`fakeSpawnSync: no rule matches ${JSON.stringify(line)}`);
    }
    return {
      status: rule.status === undefined ? 0 : rule.status,
      stdout: rule.stdout === undefined ? '' : rule.stdout,
      stderr: rule.stderr === undefined ? '' : rule.stderr,
      error: rule.error,
    };
  };
  fn.calls = calls;
  return fn;
}

/**
 * A spawn stand-in that replays a stream-json fixture on stdout and then closes.
 *
 * `delivery` controls how the bytes arrive: 'lines' one event at a time, or a number to
 * cut the stream into fixed-size chunks that split lines, which is what a real pipe
 * does and what the buffering in runSession has to survive.
 */
function fakeSpawn({ fixture, fixtures, exitCode = 0, delivery = 'lines' } = {}) {
  const calls = [];
  const fn = (file, args) => {
    // The prompt never appears in argv - it goes over stdin - so it is recorded here.
    // Several of the pipeline's guarantees are guarantees about the prompt.
    const call = { file, args, stdin: '' };
    calls.push(call);

    // A sequence replays one fixture per session, which is how an issue now runs:
    // implement, review, repair, review. The last one repeats once the list runs out,
    // so a test only has to name the sessions it cares about.
    const name = fixtures
      ? fixtures[Math.min(calls.length - 1, fixtures.length - 1)]
      : fixture;
    const text = name ? fixtureLines(name).join('\n') + '\n' : '';
    const pieces = [];
    if (delivery === 'lines') {
      for (const line of text.split('\n')) if (line) pieces.push(line + '\n');
    } else {
      for (let i = 0; i < text.length; i += delivery) {
        pieces.push(text.slice(i, i + delivery));
      }
    }

    const child = new EventEmitter();
    child.stdout = Readable.from(pieces, { encoding: 'utf8' });
    child.stdout.setEncoding = () => {};
    child.stdin = new EventEmitter();
    child.stdin.write = (text) => {
      call.stdin += String(text);
      return true;
    };
    child.stdin.end = () => {};
    child.kill = () => {};
    child.pid = 4242;

    child.stdout.on('end', () => setImmediate(() => child.emit('close', exitCode)));
    return child;
  };
  fn.calls = calls;
  return fn;
}

/**
 * Installs fakes on the orchestrator's runtime for the duration of one test and hands
 * back a restore function. Always restore in a finally: the module is a singleton
 * across the whole test file.
 */
function withFakes(ralph, { spawnSync, spawn } = {}) {
  const original = { spawnSync: ralph.runtime.spawnSync, spawn: ralph.runtime.spawn };
  if (spawnSync) ralph.runtime.spawnSync = spawnSync;
  if (spawn) ralph.runtime.spawn = spawn;
  return () => {
    ralph.runtime.spawnSync = original.spawnSync;
    ralph.runtime.spawn = original.spawn;
  };
}

module.exports = { fakeSpawnSync, fakeSpawn, withFakes };
