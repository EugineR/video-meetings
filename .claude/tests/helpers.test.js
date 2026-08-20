'use strict';

const test = require('node:test');
const assert = require('node:assert');

const ralph = require('../ralph-start.js');

test('readVerdict takes the last standalone token', () => {
  assert.equal(ralph.readVerdict('VERDICT: APPROVED'), 'APPROVED');
  assert.equal(ralph.readVerdict('**BLOCKED**'), 'BLOCKED');
  assert.equal(ralph.readVerdict('## BLOCKED'), 'BLOCKED');
  // The instruction is to end the reply with the verdict, so the last one wins.
  assert.equal(
    ralph.readVerdict('I nearly BLOCKED this, but: APPROVED'),
    'APPROVED',
  );
});

test('readVerdict does not read a verdict out of a longer word', () => {
  // No word boundary inside UNAPPROVED, so this is unreadable rather than an approval.
  assert.equal(
    ralph.readVerdict('the change is UNAPPROVED'),
    'an unreadable verdict',
  );
  assert.equal(ralph.readVerdict('nothing conclusive here'), 'an unreadable verdict');
  assert.equal(ralph.readVerdict(''), 'an unreadable verdict');
});

test('sessionOutcome is fail-closed: only a clean session returns null', () => {
  const clean = {
    exitCode: 0,
    isError: false,
    terminalReason: 'completed',
    resultText: 'done',
  };
  assert.equal(ralph.sessionOutcome(clean), null);

  assert.match(
    ralph.sessionOutcome({ ...clean, exitCode: 1 }),
    /exit code 1/,
  );
  assert.match(
    ralph.sessionOutcome({ ...clean, isError: true }),
    /reported an error/,
  );
  assert.equal(
    ralph.sessionOutcome({ ...clean, terminalReason: 'stalled' }),
    'stalled',
  );
  // An empty reply must never be mistaken for an approval.
  assert.equal(
    ralph.sessionOutcome({ ...clean, resultText: '   ' }),
    'no result event',
  );
});

test('abortedByRateLimit only fires when the limit ended an unfinished session', () => {
  const limited = { status: 'rejected', rateLimitType: 'five_hour' };
  assert.equal(
    ralph.abortedByRateLimit({ rateLimit: limited, terminalReason: 'api_error' }),
    true,
  );
  // The limit was reported but the session still finished its work.
  assert.equal(
    ralph.abortedByRateLimit({ rateLimit: limited, terminalReason: 'completed' }),
    false,
  );
  assert.equal(
    ralph.abortedByRateLimit({ rateLimit: null, terminalReason: 'api_error' }),
    false,
  );
  assert.equal(
    ralph.abortedByRateLimit({
      rateLimit: { status: 'allowed' },
      terminalReason: 'api_error',
    }),
    false,
  );
});

test('deniedTools lists each denied tool once', () => {
  const st = {
    denials: [
      { tool_name: 'PowerShell' },
      { tool_name: 'PowerShell' },
      { tool_name: 'WebFetch' },
    ],
  };
  assert.equal(ralph.deniedTools(st), 'PowerShell, WebFetch');
  assert.equal(ralph.deniedTools({ denials: [] }), '');
});

test('fillPrompt replaces every occurrence of a placeholder', () => {
  const out = ralph.fillPrompt(
    'issue #{issue} ("{title}") - close #{issue} when done',
    { issue: 41, title: 'Stream the avatar' },
  );
  assert.equal(out, 'issue #41 ("Stream the avatar") - close #41 when done');
});

test('fillPrompt leaves an unknown placeholder alone rather than blanking it', () => {
  const out = ralph.fillPrompt('on {branch} for {unknown}', { branch: 'x' });
  assert.equal(out, 'on x for {unknown}');
});

test('fillPrompt does not substitute inside a value it already filled in', () => {
  // Issue bodies go into prompts now, and a body is written by whoever filed the
  // issue. A second pass over the result would let it fill slots of its own.
  const out = ralph.fillPrompt('body: {body} on {branch}', {
    body: 'see {branch} and {issue}',
    branch: 'phase-4',
  });
  assert.equal(out, 'body: see {branch} and {issue} on phase-4');
});

test('describeTool summarises the tool call for the progress line', () => {
  assert.equal(
    ralph.describeTool({ name: 'Bash', input: { command: 'pnpm test:api' } }),
    'Bash: pnpm test:api',
  );
  assert.equal(
    ralph.describeTool({ name: 'Read', input: { file_path: 'a/b.ts' } }),
    'Read: a/b.ts',
  );
  assert.equal(ralph.describeTool({ name: 'Task', input: {} }), 'Task');
});

test('describeTool collapses whitespace and truncates', () => {
  const long = ralph.describeTool({
    name: 'Bash',
    input: { command: 'echo ' + 'x'.repeat(200) },
  });
  assert.ok(long.length <= 'Bash: '.length + 70, long);
  assert.equal(
    ralph.describeTool({ name: 'Bash', input: { command: 'a\n  b\tc' } }),
    'Bash: a b c',
  );
});

test('phaseTag is scoped by feature so two features cannot share a tag', () => {
  const phase = { index: 3 };
  assert.equal(
    ralph.phaseTag(phase, { featureBranch: 'feature/user-profile' }),
    'ralph/user-profile/phase-3',
  );
  assert.equal(
    ralph.phaseTag(phase, { featureBranch: 'chore/loop' }),
    'ralph/chore/loop/phase-3',
  );
});

test('fmtTokens and fmtDuration are readable at every magnitude', () => {
  assert.equal(ralph.fmtTokens(950), '950');
  assert.equal(ralph.fmtTokens(15_600), '16k');
  assert.equal(ralph.fmtTokens(15_612_727), '15.61M');
  assert.equal(ralph.fmtDuration(9_000), '9s');
  assert.equal(ralph.fmtDuration(789_784), '13m10s');
});

// Only Windows routes through cmd.exe; elsewhere spawn takes the argv as given.
test('shimSpawnArgs quotes arguments that would otherwise reach the shell', {
  skip: process.platform !== 'win32' && 'cmd.exe quoting is Windows-only',
}, () => {
  const [, args] = ralph.shimSpawnArgs('claude', [
    '--model',
    'sonnet',
    '--prompt',
    'Phase 3: Avatar storage & upload',
  ]);
  const line = args.join(' ');
  // The bare & is the one that broke a live run.
  assert.ok(
    line.includes('"Phase 3: Avatar storage & upload"'),
    `unquoted argument in: ${line}`,
  );
  assert.ok(line.includes('--model sonnet'), line);
});

test('shimSpawnArgs survives cmd.exe eating the last quote on the line', {
  skip: process.platform !== 'win32' && 'cmd.exe quoting is Windows-only',
}, () => {
  // The bug this guards: with /s, cmd strips the first quote and the LAST quote on the
  // command line and runs the rest verbatim. As long as the only quotes were the pair
  // around the program name that was harmless. Add a quoted argument - a comma-joined
  // --tools list is one - and cmd instead ate that argument's closing quote, leaving
  // `claude" -p ... --tools "Bash` as the program name. Nothing ran.
  const [, args] = ralph.shimSpawnArgs('claude', [
    '-p',
    '--tools',
    'Bash,PowerShell,Read',
    '--disallowedTools',
    'Task,Skill',
    '--allowedTools',
    'Bash',
    'Read',
  ]);
  const command = args[args.length - 1];

  assert.ok(command.startsWith('"'), `no leading quote to sacrifice: ${command}`);
  assert.ok(command.endsWith('"'), `no trailing quote to sacrifice: ${command}`);

  // What cmd.exe /s does, applied here: drop the first quote, drop the last quote.
  const afterCmd = command.slice(1, command.lastIndexOf('"'));
  assert.ok(afterCmd.startsWith('claude '), `program name mangled: ${afterCmd}`);
  assert.ok(
    afterCmd.includes('--tools "Bash,PowerShell,Read"'),
    `tool list lost a quote: ${afterCmd}`,
  );
  assert.ok(
    afterCmd.includes('--disallowedTools "Task,Skill"'),
    `deny list lost a quote: ${afterCmd}`,
  );
  assert.ok(afterCmd.trimEnd().endsWith('--allowedTools Bash Read'), afterCmd);
});

test('shimSpawnArgs leaves the program name unquoted for a batch shim', {
  skip: process.platform !== 'win32' && 'cmd.exe quoting is Windows-only',
}, () => {
  // The other half of the same trap. `claude` and `pnpm` are .cmd shims, and a batch
  // file invoked with a quoted name resolves %~dp0 against the current directory
  // instead of its own. Quoting the program name made pnpm.CMD look for corepack
  // inside the repository, so every gate step died with "Cannot find module".
  const [, args] = ralph.shimSpawnArgs('pnpm', ['exec', 'prettier', '--write', 'a.ts']);
  const command = args[args.length - 1];
  assert.ok(command.startsWith('"pnpm exec'), `program name quoted: ${command}`);

  // A name that could not survive unquoted is still quoted: not running at all is worse.
  const [, spaced] = ralph.shimSpawnArgs('C:/Program Files/x/pnpm', ['-v']);
  assert.ok(spaced[spaced.length - 1].startsWith('""C:/Program Files/x/pnpm"'), spaced);
});

test('a real batch shim actually runs through shimSpawnArgs', {
  skip: process.platform !== 'win32' && 'cmd.exe quoting is Windows-only',
}, () => {
  // The only assertion that would have caught this: cmd's own behaviour rather than a
  // model of it. `pnpm --version` touches nothing, costs nothing and needs no network.
  const { spawnSync } = require('node:child_process');
  const [file, args, extra] = ralph.shimSpawnArgs('pnpm', ['--version']);
  const r = spawnSync(file, args, { encoding: 'utf8', ...extra });
  assert.equal(r.status, 0, `pnpm did not run: ${(r.stdout || '') + (r.stderr || '')}`);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/, r.stdout);
});
