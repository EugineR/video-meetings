'use strict';

/**
 * A repository, a GitHub project and a package manager that only exist in memory.
 *
 * The issue pipeline talks to all three between every session: it reads HEAD, stages,
 * diffs, runs the gate, commits, closes the issue and then asks GitHub whether the
 * close actually happened. A test that faked only some of those would pass because the
 * unfaked call threw somewhere convenient, so this answers all of them and records
 * what it was asked.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
const bad = (stderr = '', stdout = '') => ({ status: 1, stdout, stderr });

function fakeRepo(opts = {}) {
  const state = {
    branch: opts.branch || 'feature/user-profile-phase-4',
    head: opts.head || 'base00000000',
    dirty: opts.dirty || '',
    open: (opts.open || [{ number: 41, title: 'Stream the avatar' }]).map((i) => ({
      ...i,
    })),
    body: opts.body === undefined ? 'Acceptance criteria: it streams.' : opts.body,
    labels: opts.labels || [],
    files:
      opts.files === undefined
        ? ['apps/api/src/meetings/avatar.controller.ts']
        : opts.files,
    // Each entry fails the first gate step whose command line contains it, once. A
    // repair session is expected to make the next run of that step pass.
    gateFails: [...(opts.gateFails || [])],
    commitFails: opts.commitFails || 0,
    closeFails: !!opts.closeFails,
    stateAfterClose: opts.stateAfterClose || 'CLOSED',
    commits: [],
    gateRuns: [],
    calls: [],
  };

  const fn = (file, args = []) => {
    const argv = args || [];
    const line = [file, ...argv].join(' ');
    state.calls.push(line);

    if (file === 'git') {
      const [verb] = argv;
      if (verb === 'rev-parse' && argv.includes('--abbrev-ref')) return ok(state.branch);
      if (verb === 'rev-parse') return ok(state.head);
      if (verb === 'status') return ok(state.dirty);
      if (verb === 'add') return ok();
      if (verb === 'diff') return ok(state.files.join('\n'));
      if (verb === 'commit') {
        if (state.commitFails > 0) {
          state.commitFails--;
          return bad('husky - pre-commit hook exited with code 1');
        }
        state.commits.push(argv[argv.indexOf('-m') + 1]);
        state.head = `commit${String(state.commits.length).padStart(6, '0')}`;
        return ok();
      }
      return ok();
    }

    if (file === 'gh') {
      if (line.includes('issue list')) return ok(JSON.stringify(state.open));
      if (line.includes('issue view') && line.includes('--json state')) {
        return ok(JSON.stringify({ state: state.stateAfterClose }));
      }
      if (line.includes('issue view')) {
        return ok(
          JSON.stringify({
            body: state.body,
            labels: state.labels.map((name) => ({ name })),
          }),
        );
      }
      if (line.includes('issue close')) {
        if (state.closeFails) return bad('HTTP 403: Resource not accessible');
        const number = Number(argv[2]);
        state.open = state.open.filter((i) => i.number !== number);
        return ok();
      }
      return ok('[]');
    }

    // Everything else is the gate: pnpm, wrapped in a cmd.exe shim on Windows.
    if (line.includes('pnpm')) {
      state.gateRuns.push(line);
      const failing = state.gateFails.find((f) => line.includes(f));
      if (failing) {
        state.gateFails.splice(state.gateFails.indexOf(failing), 1);
        return bad('', `${failing} failed\n  expected 200, received 403`);
      }
      // Deliberately chatty: a passing gate step must leave nothing behind that a
      // model then pays to read, and the tests assert this string reaches no prompt.
      return ok('Test Suites: 5 passed, 5 total\nTests: 38 passed, 38 total');
    }

    throw new Error(`fakeRepo: nothing answers ${JSON.stringify(line)}`);
  };

  fn.state = state;
  return fn;
}

/**
 * Sends the loop's runtime state to a temp directory for the duration of one test.
 * `.claude/ralph.stats.jsonl` is the baseline every cost figure is measured against -
 * a test that appended one row to it would corrupt the measurement quietly.
 */
function withTempPaths(ralph) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-test-'));
  const original = { ...ralph.paths };
  ralph.paths.log = path.join(dir, 'ralph.log');
  ralph.paths.stats = path.join(dir, 'ralph.stats.jsonl');
  ralph.paths.stop = path.join(dir, 'ralph.stop');
  return {
    dir,
    stats: ralph.paths.stats,
    restore() {
      Object.assign(ralph.paths, original);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Silences the loop's own logging for the duration of one test. */
function quiet() {
  const original = console.log;
  console.log = () => {};
  return () => {
    console.log = original;
  };
}

module.exports = { fakeRepo, withTempPaths, quiet };
