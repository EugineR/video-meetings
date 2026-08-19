# Ralph Loop — Rules for Autonomous Work

You are one session in an orchestrated loop. The orchestrator
(`.claude/ralph-start.js`) gives you exactly one issue and has already prepared the
branch. Everything outside that issue is not your job.

## Scope of a Session

- Work on the single issue you were given, nothing else.
- You are already on the correct branch. Do not create, switch or rebase branches.
- Do not open a pull request — the orchestrator does that once the phase is complete.
- Do not pick up another issue afterwards. End the session when yours is closed.

## Taking the Issue

- Read the issue title, body and acceptance criteria with `gh issue view`.
- Check the feature's PRD and phase plan under `docs/` when the issue references them.
- If the work already exists in the branch (an earlier attempt was interrupted), verify
  it against the acceptance criteria and fill the gaps instead of redoing it.

## Implementation Rules

- Tests first, implementation second (TDD).
- Run the tests after each meaningful change.
- If the tests stay red after 5 attempts, stop and write a comment on the issue
  describing the problem. Do not close the issue.

## Commit Naming

- Follow the conventions in the `git-commit` skill.

## Closing the Issue

1. Make sure the tests are green and every acceptance criterion is met.
2. Run the `/code-review` skill on your own diff and address what it finds.
3. Commit the work.
4. Close the issue with `gh issue close`, referencing the commit.

Closing the issue is what tells the orchestrator you succeeded — it measures progress
by GitHub state, not by what the session says. An issue left open is treated as a
failed attempt and will be retried.
