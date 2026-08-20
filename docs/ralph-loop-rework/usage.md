# Ralph Loop — how to use it

A short guide for developers.

> How it is built and why — [plan.md](./plan.md).

---

## What it does

It takes the open issues of a phase's milestone and implements them one at a time, each
in its own Claude session, committing to the phase branch. It then reviews the phase and
merges it into the feature branch as a single merge commit with a tag. Then on to the
next phase. When the phases run out it opens **one pull request** into `master` and stops.

```
one issue   = one session
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

Total: 5 phases, 22 issues, ~$51.20, ~106.92M gross input, at most 59 sessions
No session was started.
```

The per-issue figure is a median over *issues*, not sessions: an issue that took two attempts is
charged both, which is why it reads "10 across 14 sessions". Plan with the dollars. The token
column is gross — it includes cache reads, billed at a fraction of the input price — and is there
only for scale.

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
[14:26:30] + issue #31 closed . $1.66 . 3m25s . 24 req . 1.9M gross in . completed . run total $1.66
[14:41:02] > phase review . round 1/3 . opus
[14:44:10]   review: APPROVED . $1.36 . 31 req . 3m08s
[14:46:55] + phase 2 merged into feature/user-profile . tag ralph/user-profile/phase-2 . 13.1M
```

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
closed issues are skipped, the branch is reused, no pull request is duplicated.

---

## The loop stopped — now what

| Message                                      | What to do                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `issue #N is not progressing`                | check the last sessions in `ralph.log` and the issue comments; usually the task is ambiguous |
| `issue #N is over budget`                    | the issue is too large — split it in two                                                     |
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

Two files, both gitignored:

- **`.claude/ralph.log`** — a copy of the console output. Read it to see what happened and where it stopped.
- **`.claude/ralph.stats.jsonl`** — one JSON row per session. `schemaVersion: 2` rows carry `kind`, `phase`, `issue`, `stage`, `model`, `effort`, `terminalReason`, `assistantEvents`, `apiRequests`, `inputTokens`, `cacheCreationInputTokens`, `cacheReadInputTokens`, `grossInputTokens`, `outputTokens`, `forkedEvents`, `costUsd`, `usageQuality`, `durationMs`, `exitCode` and the rate-limit state. This is what `--dry-run` derives its median from.

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

## Review findings

Each session reviews its own diff with `/code-review` before committing and fixes what it
finds. The separate phase review is read-only and sorts findings into two buckets:

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

## Effort

`implEffort` and `reviewEffort` are not set. Effort has never been configured for this
repository, so every session so far ran at the CLI's own default — which the CLI does not
document. Setting a level would change both the cost and the quality of every session against a
baseline nobody has measured, so the keys exist and are wired through to `--effort`, but stay
unset until there is telemetry to compare against. Set one deliberately, one stage at a time, and
compare `costUsd` and the blocking findings before and after.
