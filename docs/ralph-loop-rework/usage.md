# Ralph Loop — how to use it

A short guide for developers.

> How it is built and why — [plan.md](./plan.md).

---

## What it does

It takes the open issues of a phase's milestone and implements them one at a time, each
in its own Claude session. Every issue is then gated, reviewed by a separate session and
committed **by the orchestrator** to the phase branch. It then reviews the phase and
merges it into the feature branch as a single merge commit with a tag. Then on to the
next phase. When the phases run out it opens **one pull request** into `master` and stops.

```
one issue   = implement -> gate -> review -> (repair) -> commit -> close
one phase   = one tagged merge commit on the feature branch = a rollback point
the feature = one pull request, which you merge
```

**The orchestrator never writes to `master`.**

---

## Before the first run

```bash
docker compose up -d postgres     # e2e tests hit a real database
gh auth status                    # the orchestrator talks to GitHub through gh
```

`.claude/ralph.config.json` names the feature and its branch; the phases themselves are
not listed there. They are **discovered from GitHub**: every milestone whose description
carries a `Feature: <key>` line belongs to the feature, and its position comes from the
`Phase N` prefix of its title.

```json
{
  "feature": "user-profile-page-and-editing",
  "featureBranch": "feature/user-profile",
  "featureTitle": "User profile page and editing"
}
```

Phase branches are derived, not configured: `feature/user-profile-phase-2`. The backlog
and the markers are created by the `/issues` skill from `docs/<feature>/plan.md`.

`--dry-run` prints exactly which milestones were picked up, so the discovery is always
inspectable before anything runs.

---

## A typical session

### 1. See what is coming and what it will cost

```bash
node .claude/ralph-start.js --dry-run
```

```
Feature "user-profile-page-and-editing" on feature/user-profile -> pull request into master (you merge it)
Per issue:  $2.02 (median of 10 across 14 sessions)
Per review: $1.36 (median of 5 from .claude/ralph.stats.jsonl)

  = Phase 1: Profile read & display name API (Tracer Bullet) - already merged
   5 issues  ~$ 11.45  ~23.76M gross  <= 13 sessions   Phase 4: Avatar streaming & profile response integration
   2 issues  ~$  5.39  ~11.90M gross  <=  7 sessions   Phase 6: Profile page
   ...

Total: 5 phases, 22 issues, ~$51.20, ~144.54M gross input, at most 279 sessions
No session was started.
```

The per-issue figure is a median over *issues*, not sessions: every session an issue took —
implementation, review and any repair — is charged to it, which is why it reads "10 across 14
sessions". Plan with the dollars. The token column is gross — it includes cache reads, billed at a
fraction of the input price — and is there only for scale.

The session ceiling is a worst case and reads high on purpose: an issue may take
`maxIssueAttempts × (1 implementation + maxIssueRepairs repairs + maxIssueRepairs + 1 reviews)`.
Nothing in the observed data goes near it, and the per-session dollar caps and the per-issue token
budget stop it long before.

### 2. Run as many phases as you can spare the limit for

```bash
node .claude/ralph-start.js --phases 2
```

Phases that are already done are skipped and do not count against `--phases`.

### 3. Watch

```
[14:23:05] > Phase 2 "Password change API" . branch feature/user-profile-phase-2 . 5 open issue(s) . budget 42.00M
[14:23:05] > issue #31 "Add ChangePasswordCommand" . attempt 1/2 . sonnet . maxTurns 100
[14:23:41]   . 6 events . 210k gross in . Bash: pnpm --filter api test
[14:26:12]   . gate lint:api ok
[14:26:44]   . gate typecheck:api ok
[14:27:20]   . gate test:api ok
[14:28:55]   review: APPROVED . $0.34 . 9 req . 1m31s
[14:29:02] + issue #31 closed . $1.44 . 5m57s . 1.4M gross in . committed 7f3a91c2 . run total $1.44
[14:41:02] > phase review . round 1/3 . opus
[14:44:10]   review: APPROVED . $1.36 . 31 req . 3m08s
[14:46:55] + phase 2 merged into feature/user-profile . tag ralph/user-profile/phase-2 . 13.1M
```

A gate step that fails, or a review that returns `BLOCKED`, prints a `~ repair 1/2` line
and the issue goes round again. Nothing is committed until the gate is green **and** the
reviewer said `APPROVED`.

Both say why in the log, one indented line each:

```
[15:02:11]   review: BLOCKED . $0.54 . 16 req . 2m38s
[15:02:11]     R1 [blocking] apps/api/src/users/avatar.controller.ts:42 - the ownership check is missing
[15:02:11] ~ repair 1/2 for issue #45
```

That is the only record of what the reviewer objected to - the findings otherwise go
to the repair session and nowhere else, leaving no way to tell a justified block from
a bad one afterwards. A reviewer that ignores the reply format has its reply logged
raw instead, which is itself worth seeing.

If a session goes more than two minutes without an event you get a warning. If the
silence drags on, the session is killed and retried.

### 4. Collect the result

```bash
git log --first-parent --oneline feature/user-profile   # phases
git log --oneline feature/user-profile                  # issues inside phases
git tag -l "ralph/user-profile/*"                       # rollback points
```

---

## Flags

| Flag               | What it does                                                             |
| ------------------ | ------------------------------------------------------------------------ |
| `--dry-run`        | print the plan and a cost estimate, start no sessions                    |
| `--phases N`       | run at most N phases and stop                                            |
| `--only <n\|name>` | run exactly one phase (escape hatch — warns if it skips unfinished ones) |
| `--issues N`       | stop after N closed issues, even mid-phase                               |
| `--branch <name>`  | override the phase branch; only together with `--only`                   |
| `--stop-on-limit`  | stop when the rate limit is hit instead of waiting for the reset         |
| `--config <path>`  | use the config of a different feature                                    |

With no flags every unfinished phase in the config runs.

---

## How to stop it

| Way                        | What happens                                                      |
| -------------------------- | ----------------------------------------------------------------- |
| **Ctrl-C** once            | the current session finishes, no further issue is picked up       |
| **Ctrl-C** twice           | the session is killed immediately                                 |
| `touch .claude/ralph.stop` | checked between sessions — for when you are away (overnight runs) |

Stopping is safe. Commits stay on the phase branch, closed issues stay closed, and
nothing is merged if the phase did not finish. Re-running picks up where it left off:
closed issues are skipped, the branch is reused, no pull request is duplicated — and,
since WO-3, the interrupted issue resumes at the stage it reached rather than starting over.

---

## Resuming: the checkpoint

Before every stage the orchestrator writes `.claude/ralph.state.json` — gitignored, one
small object, written to a temporary file and renamed, so a run killed mid-write leaves
either the old checkpoint or the new one and never half of one.

```json
{
  "schemaVersion": 1,
  "feature": "user-profile-page-and-editing",
  "phase": 4,
  "milestone": "Phase 4: Avatar streaming & profile response integration",
  "branch": "feature/user-profile-phase-4",
  "issue": 41,
  "issueBaseSha": "7f3a91c2...",
  "stage": "ISSUE_REVIEW",
  "reviewRound": 1,
  "commitSha": null,
  "commitSubject": "feat(api): stream the profile avatar",
  "updatedAt": "2026-08-20T14:41:02.001Z"
}
```

`stage` is one of `IMPLEMENT`, `ISSUE_GATE`, `ISSUE_REVIEW`, `REPAIR`, `COMMIT`,
`CLOSE_ISSUE`, `VERIFY_CLOSED` or `PHASE_REVIEW`. The next run resumes **that stage**, not
the issue:

| What the checkpoint says                | What the next run does                                         |
| --------------------------------------- | -------------------------------------------------------------- |
| no checkpoint, clean tree               | starts the next open issue                                     |
| no checkpoint, dirty tree               | **stops** — it never guesses whose changes those are           |
| `IMPLEMENT`                             | implements again — that session never finished                 |
| `ISSUE_GATE` or `REPAIR`                | re-runs the gate; the implementation is **not** repeated        |
| `ISSUE_REVIEW`                          | re-runs the review only — the gate was green at the checkpoint  |
| `COMMIT`                                | commits and closes; no model session at all                    |
| `CLOSE_ISSUE` / `VERIFY_CLOSED`         | closes and verifies only; the commit already exists            |
| the issue is already closed on GitHub   | marks it done; no model session at all                         |
| `PHASE_REVIEW`                          | reviews the phase again (a phase review writes nothing)         |
| `HEAD` is not where the checkpoint says, and the checkpoint still has work or a commit at stake | **stops**, with both SHAs in the message |
| `HEAD` has moved but the checkpoint left nothing behind | drops it and starts the issue from here |

The checkpoint is deleted **only** after GitHub confirms the issue closed, or once the
phase is merged. Three consequences worth knowing:

- **The tree may legitimately be dirty at startup.** The clean-tree guard is relaxed
  exactly when a checkpoint stands at a stage that leaves work in the tree (`IMPLEMENT`
  through `COMMIT`). At any other stage, or with no checkpoint at all, the loop still
  refuses to start.
- **Resuming, you stay where the loop left you.** Normally you start a run from `master`
  and nowhere else, or the loop executes the phase branch's own older copy of itself.
  But an interrupted issue's work is uncommitted *on the phase branch*, and git will not
  carry a file `master` does not have back to `master` — which is every issue that adds
  one. So a run may also start from the branch its own checkpoint names, and the loop
  checks what the guard was really protecting: that `.claude/ralph-start.js`,
  `.claude/ralph.config.json` and `.claude/ralph.md` on that branch are the same
  versions `master` has. If they are not, it refuses and tells you to merge `master` in
  first.

  ```
  | resuming on feature/user-profile-phase-4: its 3 orchestrator files match master
    mid-issue: leaving feature/user-profile-phase-4 where the checkpoint left it, no trunk merge
  ```

  The trunk merge is skipped on purpose while an issue is open: it would move `HEAD` out
  from under the commit the checkpoint measured that issue's diff from, and the resume
  would then refuse itself. The merges happen at the start of the next phase.
- **A stale checkpoint does not hold a phase back.** One that left no commit and has
  nothing in the tree is not contradicted by a moved `HEAD` — it is just older than the
  branch — so the loop says so, drops it and starts the phase normally.
- **A checkpoint whose work has been thrown away is noticed.** If you read the leftovers
  and discard them, the next run finds nothing in the tree and implements the issue again
  rather than reviewing an empty diff.

To abandon a half-finished issue: discard the working tree and delete
`.claude/ralph.state.json`. The next run starts that issue from scratch.

### Rate limits

A `rate_limit_event` carries one of three statuses — `allowed`, `allowed_warning` or
`rejected` — and **only a refusal is a limit**. `allowed_warning` is the CLI saying
"you're close to your usage limit" while letting the request through; the loop logs it
and carries on:

```
! close to the seven_day limit (resets 07:00:00), still allowed - carrying on
```

Take it as a warning that the *next* phase may not finish, not as a reason to stop this
one. The status is recorded in every stats row, so `jq 'select(.rateLimitStatus)'` tells
you afterwards which of the two a stopped run actually hit.

`onRateLimit` decides what a refusal does. **The default is `stop`** — which is cheap now,
because the checkpoint resumes the exact stage instead of repeating the issue. This
repository's `.claude/ralph.config.json` sets `wait` deliberately, for unattended
overnight runs; `--stop-on-limit` overrides it for a single run.

Waiting never costs an attempt or a review round, but it is counted and capped:
`maxRateLimitWaits` (default 4) limits how many resets one run may sit through, and
`maxRateLimitRetries` (default 3) how many times one issue — or one phase review — may be
cut off before the run stops. The phase review used to have no rate-limit handling at
all: a limit during it ended the whole run and threw away every issue the phase had
already finished.

---

## The loop stopped — now what

| Message                                      | What to do                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `issue #N is not progressing`                | check the last sessions in `ralph.log` and the issue comments; usually the task is ambiguous |
| `issue #N is over budget`                    | the issue is too large — split it in two                                                     |
| `issue #N still does not pass after N repair round(s)` | the gate or the reviewer keeps blocking; the work is in the tree — read it, fix or discard it, then re-run |
| `the commit ... was refused`                 | the pre-commit hook failed; the work is staged, the reason is in the message                 |
| `... but closing it failed`                  | the work is committed; just re-run — the checkpoint closes the issue and starts no session   |
| `reads OPEN on GitHub after being closed`    | same: the commit is safe, GitHub is not; check GitHub, then re-run                            |
| `the working tree is not clean before issue #N` | something is left over from a previous run; commit or discard it, then re-run              |
| `Working tree is not clean and no checkpoint ... explains it` | changes nothing accounts for; commit or stash them, then re-run                |
| `the checkpoint stands at ..., a stage that leaves a clean tree` | the checkpoint is past the commit but the tree is dirty; find out what wrote it |
| `the checkpoint for issue #N ... expects ... but HEAD is ...` | the branch moved under the checkpoint; work out which is right, then delete `.claude/ralph.state.json` |
| `.claude/ralph.state.json is not valid JSON` (and the other checkpoint errors) | the checkpoint is unusable; inspect it, then delete it to start that issue over |
| `is a checkpoint of feature "..." but this run is "..."` | another feature's run was interrupted; finish it or delete its checkpoint      |
| `already waited out N rate-limit reset(s)`   | the run hit `maxRateLimitWaits`; re-run later and the checkpoint resumes the stage           |
| `was cut off by the rate limit N times`      | the same stage kept being interrupted; re-run when the window is fresh                       |
| `the reviewer changed the working tree`      | the reviewer wrote something; its verdict is discarded — check what it left behind            |
| `did not pass review`                        | the phase branch is not merged and follow-up issues are filed; read them and decide          |
| `review returned ... and filed no issue`     | the reviewer blocked, or its verdict was unreadable, and left nothing to act on; read `ralph.log` |
| `the review session did not complete`        | the reviewer crashed, stalled or ran out of turns; its verdict is not trusted, so re-run     |
| `milestone ... has no issues`                | the backlog for that phase was never created; run the `/issues` skill first                 |
| `no milestone carries Feature: ...`          | the feature key in the config matches nothing on GitHub; check it against the milestones    |
| `title does not start with Phase N:`         | a milestone carries the feature marker but cannot be ordered; fix its title                 |
| `the working tree is not clean after phase`  | a session left changes behind; commit or discard them, then re-run                          |
| `hit a missing permission`                   | add it to `permissions.allow` in `.claude/settings.json` and re-run                          |
| `conflicts with master`                      | resolve the conflict on the feature branch by hand, then re-run                              |
| `pnpm test is red`                           | run `pnpm lint && pnpm test` locally, fix, re-run                                            |

In every case the fix is the same command you started with. The orchestrator works out
what is already done.

---

## Where to look afterwards

Three files, all gitignored:

- **`.claude/ralph.state.json`** — the checkpoint described under [Resuming](#resuming-the-checkpoint). Present means a run was interrupted mid-issue; absent means nothing is half-done. `--dry-run` prints it.
- **`.claude/ralph.log`** — a copy of the console output. Read it to see what happened and where it stopped.
- **`.claude/ralph.stats.jsonl`** — one JSON row per session. `kind` is `impl`, `issue-review`, `repair` or `phase-review`, and `stage` names the pipeline step (`IMPLEMENT`, `ISSUE_REVIEW`, `REPAIR`, `PHASE_REVIEW`). An issue costs the sum of its rows, which is what the per-issue estimate groups. `schemaVersion: 2` rows carry `kind`, `phase`, `issue`, `stage`, `model`, `effort`, `terminalReason`, `assistantEvents`, `apiRequests`, `inputTokens`, `cacheCreationInputTokens`, `cacheReadInputTokens`, `grossInputTokens`, `outputTokens`, `forkedEvents`, `costUsd`, `usageQuality`, `durationMs`, `exitCode` and the rate-limit state. This is what `--dry-run` derives its median from.

  Rows written before the telemetry fix have no `schemaVersion` and are read as v1: their `inputTokens` was the gross all-three sum and is normalised into `grossInputTokens`, the fields v1 never knew come back `null`, and their usage is marked `estimated` because it double-counted re-emitted messages. **Their `costUsd` is correct** — it always came straight from the CLI — so cost comparisons may span both schemas while token comparisons may not.

Spend per phase:

```bash
jq -s 'group_by(.phase) | map({phase: .[0].phase, cost: (map(.costUsd) | add), gross: (map(.grossInputTokens // .inputTokens) | add)})' .claude/ralph.stats.jsonl
```

---

## Reverting a phase

Until the feature reaches `master` every phase is a tagged merge commit on the feature
branch:

```bash
git switch feature/user-profile
git reset --hard ralph/user-profile/phase-4   # back to the state right after phase 4
git push --force-with-lease           # if the branch is already pushed
```

Or revert a single phase and keep the history:

```bash
git revert -m 1 <phase merge commit>
```

Afterwards reopen the issues you want redone and run the loop again — it will see them
as open.

---

## The issue pipeline

One issue runs through:

```text
PREPARE -> IMPLEMENT -> ISSUE_GATE -> ISSUE_REVIEW
        -> REPAIR (only when the gate or the review blocks) -> back to the gate
        -> COMMIT -> CLOSE_ISSUE -> VERIFY_CLOSED
```

- **PREPARE** records `issueBaseSha` (the current `HEAD`) and reads the issue body once.
  Everything downstream — the gate, the reviewer's diff, the commit — speaks in terms of
  that commit. A dirty tree stops the issue before a session is started; the exception is
  a retry of an issue that already has a base recorded, where the changes in the tree are
  the previous attempt's own work.
- **IMPLEMENT** gets the issue body in its prompt, so it does not fetch it. It cannot
  reach `Task` or `Skill` (`--disallowedTools`, `--disable-slash-commands`), and browser
  tools are handed only to an issue labelled `web`, `frontend`, `ui` or `e2e`. Every other
  session runs with `--strict-mcp-config` and no `--mcp-config`, so it loads no MCP server
  at all — `--tools` cannot limit MCP tools, and `--allowedTools` is never consulted for a
  tool `settings.local.json` has already permitted. It leaves the work uncommitted and
  ends with `FILES:` / `TESTS:` / `COMMIT:` lines.
- **ISSUE_GATE** is run by the orchestrator, not by a model: prettier over the changed
  files, then lint, typecheck and the unit suite of each workspace the change touched.
  Its output is captured, and **a passing step's output never reaches a session** — that
  is a large part of the saving. Steps are configurable via `issueGate`.
- **ISSUE_REVIEW** is a separate read-only session (`--tools Read,Grep,Glob,Bash`,
  `--effort high`, capped in dollars) that reviews exactly `git diff <issueBaseSha>`. Only
  an explicit `VERDICT: APPROVED` approves; a crash, a timeout, an empty reply or an
  unreadable verdict is a failure. If the reviewer changes the working tree its verdict
  is thrown away.
- **REPAIR** is a bounded session that gets only the findings (or the failing gate step's
  output) and fixes those. After it, the gate runs again from the start. `maxIssueRepairs`
  rounds, then the run stops with nothing committed.
- **COMMIT / CLOSE / VERIFY** are the orchestrator's. The commit message is the session's
  suggested subject if it really is a conventional one, otherwise one built from the
  issue — no session is ever spawned to write a commit message. The pre-commit hook still
  runs. After `gh issue close` the orchestrator asks GitHub separately whether the issue
  is closed.

If the close fails the run stops and says so: the work is committed and safe. Just
re-run — the checkpoint stands at `CLOSE_ISSUE`, so the next run closes the issue and
starts no session. It must **not** be re-implemented.

Adding `e2e` to the gate is a one-line config change, and worth it once the Postgres
container is a standing part of your runs:

```json
{ "name": "e2e", "run": ["pnpm", "--filter", "api", "run", "test:e2e"], "when": "apps/api/" }
```

It is not a default because a step that fails whenever Docker is down would block every
issue.

## Review findings

The issue review is internal: its findings go straight into a repair session and never
become GitHub issues. The separate phase review is read-only and sorts findings into two
buckets:

- **Blocking** — filed as issues **in the phase milestone**, so the loop implements the fixes and reviews again.
- **Non-blocking** — filed as issues labelled `nice-to-have` **with no milestone**, so they stay in the backlog without holding up the phase.

The `nice-to-have` backlog can be worked off later in its own run: put those issues into
a milestone of their own and add it to the phase catalogue.

---

## Common traps

- **Do not edit `phases` in the config to limit a run** — that is what `--phases` is for. Editing it is how seven phases once vanished from the catalogue.
- **Do not raise `maxTurns` "just in case".** 500 lets a single session drain the whole five-hour window. Note the `apiRequests` in the stats is not the same quantity `--max-turns` limits, so do not calibrate one against the other by eye.
- **Do not read the token counts as money.** `grossInputTokens` includes cache reads, which are billed at a fraction of the input price. `costUsd` is the figure to plan with, and it is the one the loop's caps and estimates use.
- **`/model opus` in an interactive session does not affect the loop** — the models are set explicitly in the config (`implModel`, `reviewModel`). That is deliberate: the loop used to inherit the interactive default silently and ran twice as expensive.
- **The orchestrator never merges into `master`.** The final pull request stays open until you decide; merge it **with a merge commit, not a squash**, or the per-issue history collapses.
- **One feature at a time.** Parallel runs collide over the working tree, the database and the shared rate limit — see §12 in [plan.md](./plan.md).
- **Do not put `Skill` back into `allowedTools`.** The skill an implementation session was told to run reviewed its own diff, over the wrong range, and forked a subagent to do it. That is what the issue reviewer replaced.
- **Do not add a gate step you have not run by hand.** A step that fails for an environmental reason blocks every issue of every phase, and the loop cannot tell that apart from broken code.

## Effort

`issueReviewEffort` is `high`. That stage did not exist before, so naming its effort sets a
baseline rather than changing one — and a reviewer that thinks less finds less, which is the one
saving this work is not willing to make.

`implEffort` and `reviewEffort` are not set. Effort has never been configured for this
repository, so every session so far ran at the CLI's own default — which the CLI does not
document. Setting a level would change both the cost and the quality of every session against a
baseline nobody has measured, so the keys exist and are wired through to `--effort`, but stay
unset until there is telemetry to compare against. Set one deliberately, one stage at a time, and
compare `costUsd` and the blocking findings before and after.
