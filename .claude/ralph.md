# Ralph Loop — Rules for Autonomous Work

You are one session in an orchestrated loop. The orchestrator
(`.claude/ralph-start.js`) gives you exactly one issue and has already prepared the
branch. Everything outside that issue is not your job.

## Scope of a Session

- Work on the single issue you were given, nothing else.
- You are already on the correct branch. Do not create, switch or rebase branches.
- Do not pick up another issue afterwards. End the session when the work is done.

## Taking the Issue

- The issue body is in your prompt. Do not fetch it again with `gh issue view`.
- Check the feature's PRD and phase plan under `docs/` when the issue references them —
  the section that matters, not the whole document.
- If the work already exists in the branch (an earlier attempt was interrupted), verify
  it against the acceptance criteria and fill the gaps instead of redoing it.

## Implementation Rules

- Tests first, implementation second (TDD).
- Run the tests after each meaningful change.
- If the tests stay red after 5 attempts, stop and say so in your reply. Do not leave
  the tree in a state you know is broken without saying it.

## What the Orchestrator Does, Not You

The orchestrator runs format, lint, typecheck and the test suites itself, has an
independent reviewer read your diff, and only then commits and closes the issue. So do
not:

- commit, push, or open a pull request;
- close the issue;
- review your own diff, or run a code-review skill on it;
- write review notes, diffs or scratch files into the repository.

Leave your work uncommitted. Everything that changed on top of the base commit named in
your prompt is what gets reviewed and committed.

## Ending a Session

End your reply with exactly these three lines:

```
FILES: <comma-separated paths you changed>
TESTS: <the test commands you ran>
COMMIT: <a one-line conventional commit subject for this work>
```

The commit subject follows the conventions in the `git-commit` skill. The orchestrator
uses it if it is a valid conventional subject and falls back to one built from the issue
if it is not — so a missing or malformed line costs nothing but a less precise message.

If a reviewer blocks the change you will be given its findings and asked to fix exactly
those. Fix them; do not take the opportunity to refactor something else.
