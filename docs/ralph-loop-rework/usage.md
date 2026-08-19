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

`.claude/ralph.config.json` must list the phases (`milestone` + `branch`) and name the
feature branch, and GitHub must have the matching milestones with issues. The backlog is
created by the `/issues` skill from `docs/<feature>/plan.md`.

---

## A typical session

### 1. See what is coming and what it will cost

```bash
node .claude/ralph-start.js --dry-run
```

```
Feature branch: feature/user-profile -> pull request into master (you merge it)
Estimate: 1.80M per issue (baseline, no stats yet)

  = Phase 1: Profile read & display name API (Tracer Bullet) - already merged
   5 issues  ~13.00M in  <= 13 sessions   Phase 2: Password change API
   5 issues  ~13.00M in  <= 13 sessions   Phase 3: Avatar storage & upload/delete API
   2 issues  ~ 7.60M in  <=  7 sessions   Phase 6: Profile page
   ...

Total: 7 phases, 32 issues, ~85.60M input tokens, at most 85 sessions
No session was started.
```

### 2. Run as many phases as you can spare the limit for

```bash
node .claude/ralph-start.js --phases 2
```

Phases that are already done are skipped and do not count against `--phases`.

### 3. Watch

```
[14:23:05] > Phase 2 "Password change API" . branch feature/profile-edit-phase-2 . 5 open issue(s) . budget 42.00M
[14:23:05] > issue #31 "Add ChangePasswordCommand" . attempt 1/2 . sonnet . maxTurns 100
[14:23:41]   . 6 turns . 210k in . 1.8k out . Bash: pnpm --filter api test
[14:26:30] + issue #31 closed . 24 turns . 1.9M in . 3m25s . completed . run total 1.9M
[14:41:02] > phase review . round 1/3 . opus
[14:44:10]   review: APPROVED . 31 turns . 2.4M in . 3m08s
[14:46:55] + phase 2 merged into feature/user-profile . tag ralph/phase-2 . 13.1M for the phase
```

If a session goes more than two minutes without an event you get a warning. If the
silence drags on, the session is killed and retried.

### 4. Collect the result

```bash
git log --first-parent --oneline feature/user-profile   # phases
git log --oneline feature/user-profile                  # issues inside phases
git tag -l "ralph/phase-*"                              # rollback points
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
| `review returned BLOCKED but filed no issue` | the reviewer flagged something without leaving a trace; read its output in `ralph.log`       |
| `hit a missing permission`                   | add it to `permissions.allow` in `.claude/settings.json` and re-run                          |
| `conflicts with master`                      | resolve the conflict on the feature branch by hand, then re-run                              |
| `pnpm test is red`                           | run `pnpm lint && pnpm test` locally, fix, re-run                                            |

In every case the fix is the same command you started with. The orchestrator works out
what is already done.

---

## Where to look afterwards

Two files, both gitignored:

- **`.claude/ralph.log`** — a copy of the console output. Read it to see what happened and where it stopped.
- **`.claude/ralph.stats.jsonl`** — one JSON row per session (`kind`, `phase`, `issue`, `terminalReason`, `turns`, `inputTokens`, `outputTokens`, `costUsd`, `durationMs`). This is what `--dry-run` derives its median from.

Spend per phase:

```bash
jq -s 'group_by(.phase) | map({phase: .[0].phase, tokens: (map(.inputTokens) | add), cost: (map(.costUsd) | add)})' .claude/ralph.stats.jsonl
```

---

## Reverting a phase

Until the feature reaches `master` every phase is a tagged merge commit on the feature
branch:

```bash
git switch feature/user-profile
git reset --hard ralph/phase-4        # back to the state right after phase 4
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
- **Do not raise `maxTurns` "just in case".** 100 is already double the observed 28–42 turns. 500 lets a single session drain the whole five-hour window.
- **`/model opus` in an interactive session does not affect the loop** — the models are set explicitly in the config (`implModel`, `reviewModel`). That is deliberate: the loop used to inherit the interactive default silently and ran twice as expensive.
- **The orchestrator never merges into `master`.** The final pull request stays open until you decide; merge it **with a merge commit, not a squash**, or the per-issue history collapses.
- **One feature at a time.** Parallel runs collide over the working tree, the database and the shared rate limit — see §12 in [plan.md](./plan.md).
