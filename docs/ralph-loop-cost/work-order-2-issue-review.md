# WO-2 — Independent issue review, orchestrator-owned outcome

**Read `plan.md` first for the baseline, the quality guard and the constraints. WO-1 must be merged
before this order starts — it provides the measurement this order is judged by.**

This is where both the saving and the quality gain live. It replaces per-issue **self-review** with
**independent review**, and moves the deterministic work out of the model's context.

## Why the current review is weak

`.claude/ralph.md` instructs the implementing session to run the `/code-review` skill on its own
diff. Four problems, all observed in the run log:

1. **It is self-review.** The same session, the same context, its own reasoning in view.
2. **It read the wrong range.** The session wrote `master_diff_review.txt` and
   `working_diff_review.txt` — the whole `master...HEAD` diff instead of the issue's own ~11 KB. For
   issue #39 that was ~62.8 KB of mostly unrelated code. Those stray files then blocked the phase 3
   merge with "the working tree is not clean".
3. **Its verdict binds nothing.** The orchestrator has no issue-level verdict check. If the fork
   crashed, the session committed and closed the issue anyway.
4. **There is no per-issue gate.** `runGreenGate()` (`ralph-start.js:783`) runs `pnpm lint &&
   pnpm test` once per *phase*, long after each issue is committed.

It is also the single most expensive thing in a session: the skill spawns a subagent that inherits an
implicit effort level and makes dozens of round-trips over a diff that is mostly irrelevant.

**The replacement is stronger on all four counts.** This is not a quality-for-cost trade.

## Target pipeline

One issue runs through:

```text
PREPARE -> IMPLEMENT -> ISSUE_GATE -> ISSUE_REVIEW
        -> REPAIR (only when BLOCKED) -> ISSUE_GATE -> ISSUE_REVIEW
        -> COMMIT -> CLOSE_ISSUE -> VERIFY_CLOSED -> DONE
```

The phase pipeline after all issues is unchanged: Opus phase review, blocking findings become issues,
phase green gate, `merge --no-ff`, tag.

## 1. PREPARE

Before the implementation session:

- confirm the branch is the expected one and the tree is clean;
- record `issueBaseSha = git rev-parse HEAD` — this is the anchor everything downstream uses;
- fetch the issue once with a narrow `gh issue view --json ...`;
- extract the acceptance criteria and only the relevant section of the phase plan, not the whole PRD.

## 2. IMPLEMENT

The session receives a compact issue packet: number, title, body, acceptance criteria, milestone,
branch, `issueBaseSha`, a short phase excerpt, known dependencies, the targeted test commands, and an
explicit list of what it must not do. If the packet already carries the issue body, the session must
not re-run `gh issue view`.

The implementing agent **only** implements:

- work the acceptance criteria, TDD, targeted tests;
- leave the changes uncommitted;
- return a short structured summary: files changed, acceptance criteria status, targeted tests run,
  and a suggested conventional commit message.

It must not commit, close the issue, open a PR, run `/code-review`, spawn subagents, or start another
issue. An empty diff is a failure.

Enforce that at the CLI, not only in the prompt (all verified on 2.1.237):

- `--disallowedTools` for `Task` and `Skill`;
- `--disable-slash-commands` to disable skills outright;
- `--tools` to limit the built-in set — note this limits **availability**, whereas `--allowedTools`
  only grants permission;
- Playwright only for web/e2e issues that actually need it. Backend storage, schema and unit issues
  must not see browser tools.

Be careful when narrowing the tool list: `drainIssues` currently **stops the whole run** when a
session is denied a tool and does not complete. Narrow the tools and update the prompt in the same
change, so the agent does not reach for something it can no longer have.

## 3. ISSUE_GATE — deterministic, run by the orchestrator

The orchestrator, not the model, runs:

- format/check on the changed files;
- lint for the affected workspace;
- typecheck for the affected workspace;
- the targeted tests;
- the full unit suite of the affected workspace;
- e2e when the acceptance criteria or the changed layer require it.

Reuse the `shimSpawnArgs` + `spawnSync` pattern already in `runGreenGate()` (`ralph-start.js:783`).

**Successful output never enters an LLM context** — keep a short machine-readable summary instead.
This is a large part of the saving: today the agent runs these commands itself and their output rides
along in every subsequent request of that session.

On failure, run a bounded repair session with the acceptance criteria, the current diff and only the
relevant fragment of the error. After a repair, the gate runs again from the start.

## 4. ISSUE_REVIEW — independent and bounded

A separate session. **Not** the generic `/code-review` skill.

- read-only: `--tools Read,Grep,Glob,Bash` with read-only git and test inspection only;
- no `Edit`, `Write`, `Task`, `Skill`, `WebSearch`, `WebFetch`, Playwright;
- explicit model and `--effort high` — today the fork inherits an implicit level;
- explicit cost cap via `--max-budget-usd`;
- it must not create GitHub issues and must not change files.

The prompt states the range explicitly:

```text
Base SHA: <issueBaseSha>
Working tree: current checkout
Review command: git diff <issueBaseSha> -- <changed files>
Forbidden ranges: master...HEAD, featureBranch...HEAD, unrelated commits
```

The orchestrator first computes `git diff --stat <issueBaseSha>` to get the file list and size. If
the diff exceeds a safe size, split it by file — but give the reviewer one shared acceptance-criteria
summary so it still reviews against the whole intent.

The reviewer checks correctness, security and data integrity, acceptance criteria, architecture
boundaries, error handling, test sufficiency, and migration/backward compatibility where relevant. It
should not raise cosmetic issues as blockers.

Reply format:

```text
VERDICT: APPROVED
```

or:

```text
VERDICT: BLOCKED

FINDINGS:
- id: R1
  severity: blocking
  file: path
  line: 123
  problem: ...
  reason: ...
  required_fix: ...
```

**Fail-closed.** Only an explicit `APPROVED` approves. A crash, timeout, budget cut-off, empty result
or unreadable verdict is a review failure, never an approval. Reuse the existing `readVerdict`
(`ralph-start.js:594`) and `sessionOutcome` (`ralph-start.js:580`) — this machinery is already proven
at phase level.

## 5. REPAIR

On BLOCKED:

- do **not** file a GitHub issue for an internal issue-review finding;
- run a fresh bounded repair session with only the findings, the acceptance criteria and the diff;
- run the full ISSUE_GATE again, then ISSUE_REVIEW again;
- after the configured maximum number of rounds, stop fail-closed.

## 6. COMMIT and CLOSE — by the orchestrator

After APPROVED:

1. confirm the gate result still matches the current tree;
2. stage only this issue's files;
3. commit from the orchestrator;
4. record the commit SHA;
5. `gh issue close <N> --comment "Implemented in <SHA>"`;
6. query GitHub separately to confirm the issue is actually closed;
7. only then mark the issue done.

Commit message: use the session's suggested conventional message only after validating it against a
regex; otherwise fall back to a deterministic safe message. Never spawn a model session just to write
a commit message.

Keep the pre-commit hook. Because the orchestrator now commits, the hook's output no longer lands in
an LLM context. Do not add `--no-verify`.

**Why this matters beyond cost:** issues #35 and #37 were fully implemented and committed, but the
session did not close them, so the loop spent a whole extra session each time. That failure mode
disappears.

## 7. Remove the fork — same commit

`.claude/ralph.md` currently says:

```text
2. Run the `/code-review` skill on your own diff and address what it finds.
3. Commit the work.
4. Close the issue with `gh issue close`, referencing the commit.
```

Those steps go away **in the same commit that lands the independent reviewer**. There must never be a
revision in which issues are implemented with no issue-level review. Also drop `Skill` from
`allowedTools` in `.claude/ralph.config.json`, and reconsider `Skill(code-review)` in
`.claude/settings.json` — note that file is the human's interactive config, so change it only if it
does not disrupt normal use.

## Tests for this order

- The implementation prompt contains no commit, close, review or PR instruction.
- `/code-review`, `Skill` and `Agent` are absent from the implementation and reviewer argv.
- The reviewer's commands reference `issueBaseSha` and never `master...HEAD`.
- A BLOCKED verdict always leads to repair and then a fresh gate and review.
- A commit is impossible before a green gate and an explicit APPROVED.
- A crashed reviewer does not approve.
- A `gh issue close` failure does not trigger a new implementation session.
- Playwright is absent for a backend issue and present for a browser-tagged one.
- The phase review remains a separate Opus stage.

## Canary

Only after explicit approval, and only after the fake end-to-end test passes: one small issue,
`--only <phase> --issues 1`, rate limit set to stop, no push. Then check every criterion in
`plan.md`'s canary list — including that blocking defects found per issue did **not** drop.

## Definition of done

- [x] The implementing agent never calls `/code-review`, `Skill` or `Agent` — enforced by
      `--disallowedTools`, `--tools` and `--disable-slash-commands`, and by the prompt.
- [x] A separate, bounded, read-only reviewer sees exactly the issue diff.
- [x] Reviewer model and effort are explicit (`sonnet`, `--effort high`, `--max-budget-usd 2`).
- [x] A per-issue deterministic gate runs before every commit, and its success output stays out of
      the model context.
- [x] The orchestrator performs the commit and the issue close, and verifies GitHub state.
- [x] A close failure never restarts implementation — it stops the run and says so.
- [x] The Opus phase review is untouched, apart from losing `Skill` from the shared tool list,
      which it never used.
- [x] No scratch diff files are written into the repository — no session computes a diff for
      review any more.
- [ ] Median cost per issue is at or below $1.50 with no drop in blocking defects found.
      **Open: this can only be measured by the canary, which needs explicit approval.**

### Deviations to know about

- **e2e is not a default gate step.** It needs the Postgres container, and a step that fails
  whenever Docker is down would block every issue of every phase. The one-line config to enable it
  is in `docs/ralph-loop-rework/usage.md`; every other default gate step was run against this
  repository before being made a default.
- **`implEffort` and `reviewEffort` stay unset** for the reason given in WO-1: those stages have a
  baseline nobody has measured. `issueReviewEffort` is set because that stage is new.
