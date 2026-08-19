# Ralph Loop — rework

Specification for reworking the autonomous Ralph loop. Written after investigating the
run of 18 Aug 2026, in which the loop died halfway through a phase without opening a
pull request.

Implementation branch: `chore/ralph-loop-rework` (off `master` @ `5d96876`).

Developer guide: [usage.md](./usage.md).

---

## 1. Goal

Three requirements the resulting scheme has to satisfy:

1. **Only working code in `master`** — and only code the author has approved.
2. **Phases can be rolled back** while the feature is still in progress.
3. **Readable history**: it must be clear from the issues which change followed which.

Plus one requirement that emerged from the facts: **predictable token spend**. No single
session and no single phase may burn an anomalous amount. At the same time the **number
of phases in a run is unbounded**, and hitting the five-hour rate limit is not a failure
but a reason to wait for the reset and carry on.

---

## 2. What was broken

Findings from the 18 Aug run (phase 1, issues #26–#30).

### 2.1 The loop was driven by a Stop hook that recursively spawned itself

`.claude/hooks/stop.js` called `execSync('claude -p ...')` from the Stop handler.
Consequences:

| Symptom                      | Mechanism                                                                                                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The chain died silently      | Session `9b062978` was cut off by `--max-turns` exactly on `gh issue close 30`. An aborted session never fires Stop, so no next iteration started. Issue #30 stayed open, the phase never finished, no PR. |
| Nested processes             | Every Stop hook held its child synchronously. At `maxIterations: 10` that is ten Claude processes inside one another.                                                                                      |
| stdin leaked into the prompt | `stdio: 'inherit'` handed the child the hook's own stdin, which carries the Claude Code JSON payload. Nested transcripts show `{"session_id":...}` glued onto the prompt.                                  |
| The hook fired interactively | The Stop hook had no matcher in `settings.json`, so it triggered in ordinary sessions too. During this investigation it started work on an issue twice by itself.                                          |

### 2.2 Progress was measured by a counter, not by the result

`counter.count++` incremented regardless of whether the session achieved anything.
15:15–15:18 UTC: **11 sessions in three minutes**, each building up context, hitting a
missing permission for `gh issue list`, stopping — and the hook spawning the next one.
Only `maxIterations: 10` stopped it (one start plus ten iterations).

Sessions: `34daaa8f`, `7a365417`, `cc5c6e68`, `4c5ac534`, `78d7e23f`, `c2eb183a`,
`0a75faae`, `432b60ae`, `c85fdd00`, `2696d269`, `4fa0b897`.

### 2.3 Other defects

- **`counter.count = 0` on moving to the next phase** — so there was no ceiling on a whole run at all.
- **The PR targeted `main`**; the repository's default branch is `master`.
- **No `git push` before `gh pr create`** — the phase 1 PR would have been empty (the branch was `ahead 3`).
- **The review session hunted for "the latest open PR"** blindly, with no number.
- **Review findings were posted as comments and ignored** — there was no gate on them.
- **`issues[0]`** — `gh issue list` returns newest first, so the log printed #30 while the model worked on #26. The TDD order held by luck, because the model worked it out itself.
- **The prompt was interpolated into a shell string.** The milestone title contains `&` ("read & display name"); the escaping survived by chance.
- **`ralph.iterations.json` was tracked in git** — runtime state in the repository.
- **The config had been trimmed from 8 phases to 1** locally, while all 8 milestones with issues existed on GitHub.
- **Contradictory instructions:** `ralph.md` said "Don't create a PR — Stop Hook will do that", `config.prompt` said "Don't create create a PR — just close the issue" (typo included).

---

## 3. Token measurements

All sessions on 18 Aug: **30 sessions, 25.9M input tokens, 259k output.**

### 3.1 Largest consumers

| Session                         | Input     | Model    | Note                         |
| ------------------------------- | --------- | -------- | ---------------------------- |
| `f0fe9f6c` (issues #26–28)      | 3.94M     | **opus** | most expensive loop session  |
| `a5064c27` (this investigation) | 2.70M     | opus     | interactive                  |
| `fd315837`                      | 2.47M     | sonnet   |                              |
| `9b062978` (#30, cut off)       | 2.24M     | sonnet   | **produced no closed issue** |
| `c05f1844`                      | 2.20M     | sonnet   |                              |
| `35dad337` (**#29**)            | 1.81M     | sonnet   |                              |
| **11 empty sessions**           | **1.63M** | sonnet   | **zero work**                |
| `5d34da7b` (#30, retry)         | 1.62M     | opus     |                              |

### 3.2 Debunking "issue #29 ate 70% of the limit"

Window 10:22–15:28 UTC, i.e. everything up to and including #29: **26 sessions, 21.6M
input tokens.** #29's own share is **8.4%**. Its context grew from 34k to 82k over 28
requests — no leak. The limit was consumed cumulatively before it even started; #29 was
simply the session running when the number was noticed.

### 3.3 Pure waste

- **1.63M** — 11 sessions blocked on permissions.
- **+2.24M** — the #30 cut-off, which forced a full retry (3.86M instead of 1.8M for one issue).

### 3.4 The burn formula

```
input tokens ≈ number of turns × average context size
```

For #29: 28 × ~64k = 1.8M. Cache reads are cheaper than fresh input, but they count
against the limit and dominate by volume.

**Therefore:** `maxTurns: 500` (the value at the time) is permission for one session to
drain the window. At 500 turns the context passes 200–300k, averaging ~150k — up to
**~75M input tokens in a single session**, three and a half times the entire day. Actual
demand is 28–42 turns.

### 3.5 Model choice is the biggest lever

For the day: **opus 8.4M against sonnet 17.7M**, with only 4 of 30 sessions on opus.
Direct comparison: issues #26–28 on opus cost 3.94M, issue #29 on sonnet 1.81M.

**Important:** `/model opus` is saved as the default for new sessions, and `claude -p`
inherits it unless `--model` is passed. The whole loop would have run on opus — an
unintended doubling of spend.

---

## 4. Branching model: a feature branch with rollback points

**Nothing reaches `master` automatically.** Phases accumulate on a long-lived feature
branch, each as its own merge commit with a tag. When the phases run out the orchestrator
opens **one pull request** and stops: merging is a human decision.

```
master
  ▲
  │  one PR — reviewed together, merged by hand with a merge commit
  │
feature/user-profile          ← the feature branch, alive until the feature is done
  ├─◄ merge --no-ff  feature/profile-edit-phase-2   tag ralph/phase-2
  ├─◄ merge --no-ff  feature/profile-edit-phase-3   tag ralph/phase-3
  └─◄ ...                                            issue commits inside each
```

### 4.1 Why this shape

"Only working code in `master`" really means **"only code I approved"**. Auto-merging
phases straight into `master` breaks that requirement however good the automated review
is — so the only gate in the scheme is human, and there is exactly one of it.

Rollback by phase is needed **before** the code reaches `master`: if several phases in it
becomes clear something went wrong earlier, you need to step back. Once the feature is in
`master` it is a single unit and its phase decomposition no longer matters. So the
rollback points live on the feature branch rather than in `master`'s history:

```bash
git switch feature/user-profile
git reset --hard ralph/phase-4        # back to the state right after phase 4
git revert -m 1 <phase merge commit>  # or drop one phase, keeping the history
```

### 4.2 What it costs

|                     |                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| The final PR        | ~4000 lines — line-by-line review is impossible, it needs an integration pass (§4.3)                           |
| Drift from `master` | the feature branch lives long; `origin/master` is merged in at every phase boundary, conflicts stop the loop   |
| Prisma migrations   | they accumulate on the branch; ordering is checked every time `master` is merged in                            |
| Phases in `master`  | not visible as separate units after the merge — a deliberate price, since rollback is only needed pre-`master` |

### 4.3 How to review the final PR

Line by line is unrealistic, and it is not required: every phase already passed an
automated Opus review before being merged, and blocking findings became issues and were
fixed. The final review is an integration pass:

- coherence of the Prisma schema and migration ordering across all phases;
- integrity of the API surface: did the DTOs drift between early and late phases;
- dead code and "for later" abstractions that never got used;
- whether `CLAUDE.md` and the README still match;
- a manual end-to-end run of the application.

Granularity is not lost: `git log --first-parent feature/user-profile` lists the phases,
the full log lists the issues inside them.

### 4.4 Hard rules

- **The orchestrator does not write to `master`.** No `gh pr merge`, no push to the trunk.
- **Phases merge with `--no-ff`** — without a merge commit there is no rollback point.
- **No `--squash` anywhere**, the final PR included: it would collapse the per-issue history.
- **Phase branches are cut from the feature branch**, never from `master`.

---

## 5. Orchestrator algorithm

A single process, `.claude/ralph-start.js`. **The Stop hook is not part of the scheme and
is removed from `settings.json`.** Control is inverted: an external `while` loop starts
the sessions and decides what happens next.

```
cfg  = .claude/ralph.config.json
if (!cfg.active) exit
base = gh repo view --json defaultBranchRef -q .defaultBranchRef.name     // "master"
budget = { runTokens: 0, runCost: 0, issuesClosed: 0 }

FOR EACH phase IN cfg.phases:

  ─── 0. Skip what is already done ──────────────────────────────────
  open = issues(phase.milestone, open, sorted by ASCENDING number)
  IF open is empty AND the phase is already merged  →  next phase

  ─── 1. Branches: feature branch and phase branch ──────────────────
  branch = --branch ?? phase.branch          // the name is yours, see §5.5
  git fetch origin --prune --tags

  IF the feature branch does not exist  →  create it from origin/<base>
  ELSE                                  →  switch, fast-forward from origin/<feature>
  IF the feature branch does not contain origin/<base>:
      git merge origin/<base>                // pull in the trunk that moved on
      IF conflict  →  STOP "feature branch conflicts with base"

  IF the phase branch does not exist  →  git switch -c branch <feature branch>
  ELSE                                →  switch; if behind, merge <feature branch> in

  ─── 2. Issue loop ─────────────────────────────────────────────────
  WHILE open is not empty:
      checkBudget()                          // see §6, any breach → STOP
      issue = open[0]                        // lowest number = TDD order

      result = runSession({
          model:    cfg.implModel,           // sonnet, explicitly
          maxTurns: cfg.maxTurns,
          prompt:   implPrompt(phase, issue) // with an EXPLICIT issue number
      })
      budget += result.usage                 // §6.6

      IF result.permission_denials is not empty  →  STOP "missing permission X"
      IF the rate limit was hit                  →  wait for reset (§6.5)

      open = issues(phase.milestone, open)   // progress is measured on GitHub
      IF the issue closed:
          attempts[issue] = 0
      ELSE:
          IF ++attempts[issue] >= cfg.maxIssueAttempts  →  STOP "issue #N is not progressing"
          // otherwise retry the same issue — the session picks its state up from git

  ─── 3. Phase review ───────────────────────────────────────────────
  round = 0
  WHILE true:
      IF ++round > cfg.maxReviewRounds  →  STOP "phase did not pass review"
      review session over the range <feature branch>...<phase branch>
      // it files issues for blocking findings and ends with APPROVED / BLOCKED
      IF no open issues:
          IF the verdict was BLOCKED  →  STOP "BLOCKED with no issue filed"
          ELSE                        →  leave the loop
      ELSE  →  back to step 2 to fix them, then review again

  ─── 4. Green gate ─────────────────────────────────────────────────
  pnpm lint && pnpm test        // the only server-side check: there is no CI on GitHub
  IF it fails  →  STOP "tests are red, the phase branch is not merged"

  ─── 5. Merge the phase into the feature branch ────────────────────
  git switch <feature branch>
  git merge --no-ff -m "merge(<phase branch>): <milestone>" <phase branch>
  IF conflict  →  merge --abort, STOP
  git tag -f ralph/phase-<N>              // ← the rollback point
  git push origin <feature branch> and the tag


ONCE EVERY PHASE IN THE CATALOGUE IS MERGED:
  gh pr create --base <base> --head <feature branch>      // one PR for the feature
  STOP. The orchestrator does not write to <base> — merging is the human's job.
```

### 5.1 What each decision fixes

| Decision                                                | Problem from §2                                                                                       |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| External `while` instead of a Stop hook                 | a turn-limit abort no longer kills the chain; no nested processes; the hook cannot fire interactively |
| Async `spawn` with args as an array, prompt over stdin  | no shell escaping, no stdin leak, and the process stays responsive to signals                         |
| `open[0]` ascending plus the issue number in the prompt | TDD order stops being accidental; the session spends no turns hunting for the issue                   |
| Progress measured on GitHub                             | a session that stalls or hits a permission wall no longer counts as an iteration                      |
| `attempts >= 2 → STOP`                                  | the `gh issue close` cut-off heals itself through a retry, but an infinite loop is impossible         |
| Phase branch cut from the feature branch                | phase N+1 builds on phase N without waiting for a merge                                               |
| Diff range in the review prompt                         | the review looks at exactly what the phase added instead of guessing at a PR                          |
| Follow-up issues → back to step 2                       | review findings stop being comments nobody reads                                                      |
| `--no-ff` on the phase merge, plus a tag                | the phase stays a separate merge commit on the feature branch — a rollback point until `master`       |
| The orchestrator never writes to `master`               | code reaches the trunk only through one pull request, merged by a human                               |

### 5.2 Observability: what the console shows

Previously `stdio: 'inherit'` dumped the raw session stream, from which you could tell
neither which issue was being worked on, nor how long it had been running, nor whether
the process was alive. The orchestrator now parses `stream-json` and prints its own
lines:

```
[14:23:05] > Phase 2 "Password change API" . branch feature/profile-edit-phase-2 . 5 open issue(s)
[14:23:05] > issue #31 "Add ChangePasswordCommand" . attempt 1/2 . sonnet . maxTurns 100
[14:23:41]   . 6 turns . 210k in . 1.8k out . Bash: pnpm --filter api test
[14:26:30] + issue #31 closed . 24 turns . 1.9M in . 3m25s . completed . run total 1.9M
```

Lines are appended only, with no cursor repainting, so the output stays readable when
scrolled back and behaves the same in every terminal. The same stream goes to `ralph.log`.

**Stall detector.** If no event arrives from the session for longer than `stallSeconds`
(120 by default), the orchestrator prints a warning naming the last event. If the silence
lasts `stallSeconds × 3` the session is killed and the attempt is counted. That is the
direct answer to "is it working or is it stuck": silence becomes a visible, handled state
rather than a guess.

**Printed at boundaries:** phase start (branch, where it was cut from, issue count), issue
completion (closed or not, resources, `terminal_reason`), review outcome (`APPROVED` /
`BLOCKED` plus follow-up numbers), the green gate result, the phase merge and its tag.
Every STOP from §9 prints its reason and what was left in a working state.

### 5.3 Interruption and resumption

**Previously the loop could not be stopped.** The Stop hook spawned its child through
`execSync`; the hook itself timed out while the child session kept running — observed on
18 Aug, where sessions lived 8–10 minutes after the hook that spawned them had died.
Killing "the parent" achieved nothing, because there was no real parent.

**Now it works.** One orchestrator process, one child session at a time, started through
an asynchronous `spawn`. Asynchronous specifically: `spawnSync` blocks the event loop and
the signal handler would not run until the session ended.

| Way                       | Behaviour                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------ |
| Ctrl-C once               | graceful: the current session finishes, no further issue is picked up, state printed |
| Ctrl-C twice              | hard: the child session is killed immediately                                        |
| `.claude/ralph.stop` file | checked between sessions — for when you are away from the terminal                   |

**Interrupting is safe and resumable.** What is left behind:

- commits the sessions already made, on the phase branch;
- closed issues stay closed;
- **nothing is merged** if the phase did not reach step 5.

Re-running picks the state up: step 0 skips closed issues, step 1 reuses the existing
branch, and the final PR is created only once. An issue interrupted mid-session simply
gets a retry — exactly the scenario that worked for #30.

### 5.4 Run control: which phases to execute

`cfg.phases` is a **catalogue** of every phase of the feature, not the programme for a
given run. What actually executes is set by command-line flags. Editing the config to
limit a run is neither necessary nor advisable: that is how the catalogue was once
trimmed from 8 phases to 1 (§2.3).

```
node .claude/ralph-start.js [options]

--phases N        run at most N phases and stop (default: all)
                  only phases actually executed count; ones already finished are
                  skipped by step 0 and do not count
--only <n|name>   run exactly one phase (escape hatch, see below)
--issues N        stop after N closed issues, even mid-phase
--dry-run         print the plan and a cost estimate, start nothing
--stop-on-limit   stop on a rate limit instead of waiting (overrides onRateLimit)
--branch <name>   override the phase branch; only together with --only (§5.5)
--config <path>   a different phase catalogue
```

The "leave some limit spare" workflow:

```
$ node .claude/ralph-start.js --phases 2 --dry-run
   5 issues  ~13.00M in  <= 13 sessions   Phase 2: Password change API
   5 issues  ~13.00M in  <= 13 sessions   Phase 3: Avatar storage & upload/delete API
Total: 2 phases, 10 issues, ~26.00M input tokens, at most 26 sessions

$ node .claude/ralph-start.js --phases 2
```

The estimate comes from the median in `ralph.stats.jsonl`; until there is one, from the
§3 baseline (1.8M per issue, 4M per review round). **The running total is printed as it
goes**, on every issue-completion line, so the remaining limit is visible without leaving
the loop.

**There is deliberately no start-at-phase flag.** Which phases are finished follows
unambiguously from GitHub (step 0), and a manual starting point can only lie. The one way
to jump over an unfinished phase is `--only`, and it is an escape hatch: phases depend on
each other, so if earlier phases still have open issues the orchestrator prints a warning
before starting.

**Caveat on `--issues N`.** Stopping mid-phase leaves the branch unmerged. That is a
normal resumable state (§5.3), but the phase will not close until the remaining issues
are done. For "stop after this phase" the right flag is `--phases`.

### 5.5 Phase branches: who names them

**The branch name is still yours**, given by the `branch` field of the phase:

```json
{
  "milestone": "Phase 2: Password change API",
  "branch": "feature/profile-edit-phase-2"
}
```

Deriving the name from the milestone title is deliberately not done: the branch name ends
up in the pull request, in the merge commit and in history for good, so a human should
choose it rather than a slugifier.

What changed is not who names the branch but **what the orchestrator does with it**:

| Situation                        | Behaviour                                                          |
| -------------------------------- | ------------------------------------------------------------------ |
| The branch does not exist        | cut from the feature branch — phase N+1 sees the result of phase N |
| The branch exists (resumed run)  | reused; if the feature branch moved ahead, it is merged in         |
| Merging the feature branch fails | STOP with a message, the branch is left alone                      |
| The phase is already merged      | step 0 skips it (tag present, or the branch is an ancestor)        |

Previously the session created the branch itself ("Check that the specified branch already
exists — if not, create it" in `ralph.md`), and what it branched from depended on wherever
the working directory happened to be. That rule is removed from `ralph.md` (§8).

**One-off override:** `--branch <name>`, only together with `--only`, otherwise one name
would be handed to several phases.

**After a merge** the phase branch is kept both locally and on the remote — the
orchestrator does not delete it, so that the branch and its tag together form the rollback
point. Clean up by hand once the final PR is merged.

---

## 6. Protection against burning tokens

An iteration counter limits the **number of sessions**; tokens are burned by **turns ×
context size**. Both kinds of safeguard are needed.

### 6.1 Why there is no global run budget

The first draft of this document proposed `maxCostUsd` / `maxInputTokens` for a whole run.
That was wrong: such a limit conflates two different jobs.

- **Catching an anomaly** — "something is burning an abnormal amount". The only unit where the expected cost is predictable is small: one issue, one phase.
- **Capping the wallet** — "how much am I willing to spend in total". But there is no wallet in dollars, there is a five-hour window. Any invented number is a poor proxy for it.

A global ceiling solves neither: to let a 20-phase feature through it has to be set so
high that it catches nothing within a single phase. **The number of phases in a run must
be unbounded.**

### 6.2 The structural bound

Spend is bounded by the product of the ceilings, on its own, without any money limit:

```
per session  ≤ maxTurns                                   (100)
per issue    ≤ maxIssueAttempts sessions                   (2)
per phase    ≤ issues × maxIssueAttempts + maxReviewRounds sessions
```

For a five-issue phase that is at most 13 sessions. No infinite loop is possible for any
number of phases. A token budget on top of that is **not a safeguard but an early
warning**: "this phase is going badly, stop before it burns all 13 sessions."

### 6.3 Layers of protection

| Layer                | Bounds                       | On breach                                                              |
| -------------------- | ---------------------------- | ---------------------------------------------------------------------- |
| `maxTurns`           | one session                  | the session is cut off, `terminal_reason` is seen, a retry follows     |
| `maxIssueAttempts`   | attempts on one issue        | STOP "issue #N is not progressing"                                     |
| `maxReviewRounds`    | review → fix → review cycles | STOP, the phase branch is left unmerged                                |
| `issueBudgetTokens`  | one issue including retries  | STOP "issue #N is over budget"                                         |
| derived phase budget | one phase                    | STOP "phase is over budget", branch left unmerged                      |
| `onRateLimit`        | the external limit           | pause until the window resets, then carry on — not a retry, not a stop |

Plus two immediate stops outside the counters: a non-empty `permission_denials`, and a
git merge conflict.

### 6.4 The budget is derived, not configured

```
phase budget = issueBudgetTokens × issues in the phase
             + reviewBudgetTokens × maxReviewRounds
```

A two-issue phase gets its own ceiling, a five-issue phase another, automatically. The
only hand-tuned number is `issueBudgetTokens`, calibrated from the facts: the median
issue session in §3 is **1.8M input tokens**, so the anomaly threshold is 3× that, **6M**.
Refine it after each run from `ralph.stats.jsonl`.

### 6.5 Rate limit: pause, not stop

For large features the binding constraint is not the budget but the five-hour window. The
right reaction is to **wait for the reset and continue**: waiting costs no tokens, and a
20-phase feature simply rides through several windows, overnight included. That is the
scenario the loop exists for.

`onRateLimit: "wait"` (the default) or `"stop"` if a run must stay inside one window.

### 6.6 Where the telemetry comes from

`claude -p --output-format json` returns (verified):

```json
{
  "is_error": false,
  "num_turns": 1,
  "stop_reason": "end_turn",
  "terminal_reason": "completed",
  "total_cost_usd": 0.10598,
  "permission_denials": [],
  "usage": {
    "input_tokens": 2,
    "cache_creation_input_tokens": 9843,
    "cache_read_input_tokens": 13035,
    "output_tokens": 4
  },
  "modelUsage": {},
  "api_error_status": null
}
```

The `stream-json` variant additionally emits a `rate_limit_event`:

```json
{
  "rate_limit_info": {
    "status": "allowed",
    "resetsAt": 1787150400,
    "rateLimitType": "five_hour"
  }
}
```

What is used:

- **`usage`** — `input_tokens + cache_creation + cache_read` feeds the budget.
- **`total_cost_usd`** — recorded per session. On a subscription this is the equivalent API cost rather than a bill, but as a measure of burn it is exact.
- **`permission_denials`** — a non-empty array means the session hit a permission wall. One check kills the whole 1.63M waste class.
- **`terminal_reason` / `stop_reason`** — `completed` versus an abort. Diagnosis without hand-parsing `.jsonl` transcripts.
- **`rate_limit_info.resetsAt`** — the exact reset time, so the wait is precise instead of guessed from error codes.

### 6.7 Output mode

Sessions run with `--output-format stream-json --verbose`. The orchestrator reads the
stream, catches the final `type: "result"` event for telemetry, and **builds the live
progress view from the same stream** (§5.2).

The raw session output no longer reaches the terminal, but the replacement is more
informative, not less: the phase, the issue, the attempt number, accumulated turns and
tokens, the last tool invoked and the time since the last event. Those are exactly the
facts that were missing when trying to tell work from a hang.

Alternatives if needed: `--output-format json` gives telemetry only at the end with no
live view; `text` behaves like the old setup, with no telemetry and no stall detector,
and is not recommended.

---

## 7. Configuration values

```json
{
  "active": true,
  "featureBranch": "feature/user-profile",
  "featureTitle": "User profile page and editing",
  "niceToHaveLabel": "nice-to-have",
  "implModel": "sonnet",
  "reviewModel": "opus",
  "maxTurns": 100,
  "maxIssueAttempts": 2,
  "maxReviewRounds": 3,
  "issueBudgetTokens": 6000000,
  "reviewBudgetTokens": 4000000,
  "stallSeconds": 120,
  "onRateLimit": "wait",
  "phases": []
}
```

Rationale:

- **`featureBranch` / `featureTitle`** — the long-lived branch and the title of the final pull request.
- **`niceToHaveLabel`** — the label for non-blocking review findings (§8.1). The orchestrator creates it if it is missing.
- **`implModel: "sonnet"`** — roughly 2.2× cheaper on the bulk of the work (3.94M on opus against 1.81M on sonnet for comparable tasks). Set it **explicitly** so the interactive default is never inherited.
- **`reviewModel: "opus"`** — worth it for review, which happens once per phase.
- **`maxTurns: 100`** — double the observed 28–42. Bounds the worst case at ~8M instead of ~75M per session.
- **`issueBudgetTokens: 6M`** — 3× the median issue session (1.8M, §3). An early anomaly signal, recalibrated from `ralph.stats.jsonl`.
- **`reviewBudgetTokens: 4M`** — review runs on opus, where comparable work cost 3.94M.
- **`onRateLimit: "wait"`** — pause until the five-hour window resets and continue. For a feature of many phases this is the only way to reach the end; waiting is free. Use `"stop"` to keep a run inside one window.
- **`phases`** — the catalogue of every phase, each a `{ milestone, branch }` pair; the branch name is yours (§5.5). **Do not touch it to limit a run.** The number of phases is unbounded.

There is no global `maxSessions` / `maxInputTokens` / `maxCostUsd` — see §6.1. The phase
ceiling is derived from its issue count (§6.4), and a run-level ceiling is unnecessary
because spend is bounded structurally (§6.2).

### 7.1 What not to do

- Do not raise `maxTurns` without redoing the arithmetic in §3.4.
- Do not use `--squash` at any level.
- Do not run `claude -p` without an explicit `--model`.
- Do not bring the Stop hook back into the control flow.
- Do not give the orchestrator permission to merge into `master` — the only gate is human.
- Do not merge a phase with `--ff`: without a merge commit the rollback point disappears.
- Do not edit `phases` to limit a run — `--phases` / `--only` exist for that (§5.4).

---

## 8. Review findings

Two mechanisms, with different behaviour.

**Per issue** — the implementing session runs `/code-review` on its own diff before
committing and fixes what it finds, inside the same session (`.claude/ralph.md`).

**Per phase** — a separate read-only Opus session over the `feature...phase` range. It
does not touch the code; it files issues, and the fixes are made by fresh implementing
sessions through the same TDD pipeline. Keeping judgement and editing apart matters: a
reviewer that fixes tends to rationalise its own edits, and this way every fix goes
through the same gate as any other issue.

### 8.1 Blocking and nice-to-have

The review sorts every finding into one of two buckets:

| Bucket           | Filed as                                           | Effect on the loop                               |
| ---------------- | -------------------------------------------------- | ------------------------------------------------ |
| **Blocking**     | an issue **in the phase milestone**                | the loop implements the fix and reviews again    |
| **Non-blocking** | an issue labelled `nice-to-have`, **no milestone** | stays in the backlog, does not hold up the phase |

Blocking means: a bug, a security or data-integrity problem, a missing acceptance
criterion, or a design decision later phases would have to work around. Everything else —
naming, small refactors, extra test cases, documentation polish — is nice-to-have.

Because `openIssues()` filters by milestone, a `nice-to-have` issue with no milestone is
invisible to the loop by construction. That is what keeps the loop from sliding into
endless polishing while still not losing the observation.

The `nice-to-have` backlog is worked off later in a run of its own: collect the issues
into a milestone and add it to the phase catalogue.

**The gate is fail-closed.** Only an explicit `APPROVED` from a cleanly completed review
merges a phase. A reviewer that crashed, stalled, ran out of turns, produced no result
event, or returned a verdict that could not be read is treated as blocking — otherwise a
broken reviewer would silently ship an unreviewed phase. `BLOCKED` with no filed issue is
likewise a stop, since the loop would have nothing to act on.

---

## 9. Stop conditions — all explicit

The loop halts with a clear message and leaves the phase branch unmerged in ten cases.
There is no silent exit — the "it died and nobody noticed" scenario becomes impossible.

1. An issue did not progress after `maxIssueAttempts` attempts.
2. An issue went over `issueBudgetTokens`.
3. A phase went over its derived budget (§6.4).
4. `maxReviewRounds` were exhausted; the review session did not complete cleanly; or its verdict was anything other than `APPROVED` while it filed no issue.
5. A non-empty `permission_denials`.
6. A conflict on `git merge` / `git pull`.
7. `pnpm lint` or `pnpm test` is red before the merge.
8. Merging the phase branch into the feature branch failed.
9. The milestone of a phase has no issues at all — the backlog was never created.
10. The working tree was left dirty by a session, before the phase merge.

The rate limit is **not** on this list: with `onRateLimit: "wait"` it causes a pause until
the window resets, not a stop (§6.5).

---

## 10. Acceptance criteria

- [ ] A whole phase runs through: every milestone issue closed, the phase reviewed and merged into the feature branch as a tagged merge commit.
- [ ] `git log --first-parent --oneline feature/user-profile` lists the phases; `git log --oneline` lists the issues inside them, in implementation order.
- [ ] `git reset --hard ralph/phase-N` on the feature branch restores the state right after phase N.
- [ ] Over a whole run not one commit reaches `master`; the final pull request stays open.
- [ ] A session cut off by `--max-turns` leads to a retry, not to the loop stopping.
- [ ] A missing permission stops the loop on the first session, not the eleventh.
- [ ] A stalled session is detected by `stallSeconds`, not by watching the terminal.
- [ ] The console always shows the phase, the issue, the attempt, the turns and the time since the last event.
- [ ] Ctrl-C stops the loop; re-running continues from the same point without duplicating anything.
- [ ] `--phases 2` runs exactly two phases and stops, leaving the rest alone.
- [ ] `--dry-run` prints the composition and the estimate without starting a session.
- [ ] Non-blocking review findings end up as `nice-to-have` issues with no milestone and are not picked up by the loop.

---

## 11. Open questions

- **Prisma migrations.** Phases 3–4 add an avatar column. They accumulate on a long-lived branch, so the ordering has to be checked every time `master` is merged in.
- **Calibrating `issueBudgetTokens`.** The starting 6M is 3× the phase 1 median. After the first runs, compare against `ralph.stats.jsonl`: if real sessions land consistently lower, lower the threshold — it is more useful the closer it sits to reality.
- **Phase size** is decided by rollback granularity and review size (§4), **not** by the token budget. There is no need to fit phases to a ceiling: the ceiling adapts to the issue count.
- **Working off the `nice-to-have` backlog** — whether to gather it per feature or globally is still open.

---

## 12. Limits: several features at once

This rework assumes **one feature at a time**. The "two unrelated loops" case is not
implemented, but the constraints are recorded so the decision can be made knowingly.

### 12.1 Sequentially — works almost as is

One flag is enough: `--config <path>`, making the phase catalogue a per-feature file
(`.claude/ralph.profile-edit.json`, `.claude/ralph.notifications.json`). Nothing else
changes. Running one feature and then the other is safe and needs no new architecture.

### 12.2 In parallel — four hard constraints

| Constraint             | Substance                                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **One working tree**   | The orchestrator runs `git switch`. Two loops in one clone fight over HEAD and the index. It would need a `git worktree` per feature.         |
| **Shared Postgres**    | `pnpm test` in `apps/api` runs e2e against a real database. Two concurrent test runs corrupt each other's data. A database per run is needed. |
| **Shared rate limit**  | The five-hour window is per account. Two loops do not double throughput — they split the same window and exhaust it twice as fast.            |
| **Single state files** | `ralph.log` and `ralph.stop` are global. They would need a run identifier in the name.                                                        |

### 12.3 Conclusion

The third constraint decides it: **parallelism buys nothing**, because it hits the same
limit while demanding worktrees, a separate database and split state files. On top of
that both features merge into the same `master`, so while one pull request is in flight
the other branch goes stale and the conflicts land on a human.

The recommended path is therefore **sequential runs with `--config`**, not parallel loops.
Should parallelism ever be needed, the minimum is: a `git worktree` per feature, a
separate Postgres schema per run, and a run suffix on `ralph.log` / `ralph.stop`.
