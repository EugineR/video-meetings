# Ralph loop cost — research

**Verified against the code, the runtime telemetry and the installed CLI on 2026-08-20.**

Sources: `.claude/ralph-start.js` (1260 lines), `.claude/ralph.config.json`, `.claude/ralph.md`,
`.claude/settings.json`, `.claude/ralph.stats.jsonl` (19 rows, issues #31-#40 plus 5 phase reviews),
`.claude/ralph.log` (265 lines), and Claude CLI 2.1.237.

This document records **what is wrong and why**. The fixes are in `plan.md` and the three work
orders next to it.

## 1. Measured cost

`total_cost_usd` from the `result` event is the only number the current telemetry gets right; it is
parsed correctly at `ralph-start.js:534`.

| Issue | Cost | Sessions | Wall time |
| --- | --- | --- | --- |
| #31 | $1.66 | 1 | 7m |
| #32 | $1.72 | 2 | 6m |
| #33 | $1.16 | 1 | 4m |
| #34 | $1.89 | 1 | 7m |
| #35 | $2.02 | 2 | 9m |
| #36 | $2.55 | 1 | 10m |
| #37 | $2.30 | 2 | 8m |
| #38 | $1.54 | 1 | 6m |
| #39 | $3.54 | 2 | 13m |
| #40 | $4.42 | 1 | 13m |

Median **$2.02**, mean **$2.28**. Phase reviews on Opus: 5 sessions, $6.13 total, $1.23 each.
Everything observed so far: **$28.93**.

Twenty-two issues remain across phases 4-8, so the current backlog is roughly **$58**.

Note the sessions column: issues #32, #35, #37 and #39 each needed a second session. Two of those
(#35, #37) were fully implemented and committed but not closed, so the loop started an entirely new
session to finish the bookkeeping.

## 2. Why the token numbers must not be trusted

`ralph-start.js:513-520`:

```js
if (ev.type === 'assistant' && ev.message) {
  st.turns++;
  const u = ev.message.usage || {};
  st.inputTokens +=
    (u.input_tokens || 0) +
    (u.cache_creation_input_tokens || 0) +
    (u.cache_read_input_tokens || 0);
  st.outputTokens += u.output_tokens || 0;
```

Four defects in nine lines:

- every `assistant` stream event counts as a turn, with no de-duplication by `message.id`;
- usage is re-summed for events belonging to the same message;
- cache reads are added to normal input at face value;
- the aggregate `usage` on the final `result` event is ignored entirely.

The consequences are visible in the data:

- **Issue #40 recorded 156 "turns" under a `--max-turns 100` cap** and still reported
  `terminalReason: "completed"`. The counter does not measure what the CLI limits.
- **`outputTokens` reads 743 for a session that cost $4.42.** Implausible by orders of magnitude.
- Issue #40's 15.6M "input tokens" ran against a 6M `issueBudgetTokens` cap that never fired.

Anything derived from these numbers — the budget, the `--dry-run` estimate, the progress line — is
derived from noise.

## 3. The eight defects

### P0 — the generic `/code-review` fork

`.claude/ralph.md` tells every implementing session:

```text
2. Run the `/code-review` skill on your own diff and address what it finds.
```

`Skill` is in `allowedTools` in `.claude/ralph.config.json`, and `Skill(code-review)` is permitted in
`.claude/settings.json`, so the fork is fully enabled. The log confirms it fires — `Agent` and
`Skill` appear as the active tool in implementation sessions.

The skill creates a separate agent that inherits an implicit effort level, reads a broad diff and
makes dozens of round-trips. This is the largest single line item in a session.

### P0 — the review range was wrong

The reviewer used `master...HEAD` plus the working tree instead of the issue's own diff. The log
shows it writing `full_diff_review.txt`, `master_diff_review.txt` and `working_diff_review.txt`. For
issue #39 that produced roughly 62.8 KB of diff where the issue's actual change was about 10.9 KB.

Those three files then made the tree dirty and blocked the phase 3 merge outright:

```text
[03:05:26] !! STOPPED: the working tree is not clean after phase "Phase 3: ...", refusing to merge:
?? full_diff_review.txt
?? master_diff_review.txt
?? working_diff_review.txt
```

**Status update:** the files no longer exist, `*_diff_review.txt` was added to `.gitignore` in commit
`29183a5`, and phase 3 was merged by hand afterwards (`8c1e3ea`). That is a band-aid — the files are
still written and re-read, and the reviewer still looks at the wrong range. The real fix is to hand
the reviewer an exact diff range instead of letting it choose one.

### P0 — review is self-review, and its verdict binds nothing

The same session that wrote the code reviews it, in its own context, with its own reasoning in view.
And the orchestrator has **no issue-level verdict check at all**: `readVerdict` and `sessionOutcome`
exist and are used, but only in `reviewPhase`. If the fork crashed, the implementing session
committed and closed the issue regardless.

### P0 — the model owns commit and close

`ralph-start.js` never calls `git commit` or `gh issue close`; both are delegated to the session by
`implPrompt` and `ralph.md`. Progress is measured purely by GitHub state
(`ralph-start.js:852-856`), so an issue whose code is finished but whose `gh issue close` did not run
looks exactly like a failed attempt and gets a whole new session. This happened to issues #35 and
#37.

### P0 — there is no per-issue gate

`runGreenGate()` (`ralph-start.js:783`) runs `pnpm lint` and `pnpm test` **once per phase**, after
every issue in that phase is already committed. Between issues, nothing deterministic runs. The
agent runs tests itself, inside its own context, and all that output rides along in every subsequent
request of the session.

### P1 — the budget is not a limiter

- It is only checked after a session ends — nothing stops a runaway mid-flight.
- For a successfully closed issue it is skipped entirely: the check at `ralph-start.js:884` sits
  after `if (closed) { ...; continue; }` at line 859.
- It is denominated in the broken gross token counter.
- `reviewPhase` accumulates the phase total but never checks it.

### P1 — a rate limit repeats the work

With `onRateLimit: "wait"` the loop waits for the reset and then starts a **fresh session for the
same issue**. There is no checkpoint, so implementation, gate and review can all run twice. During
issue #39 the loop waited **3h 35m** and then re-ran an issue that had already cost $1.83.

`reviewPhase` is worse: it has **no rate-limit retry branch at all**. A limit during phase review
fails `sessionOutcome` and ends the entire run. This was not in the original investigation.

### P2 — auto-loaded context is an inventory, not a rulebook

Every `apps/api` session loads 39.4 KB of instructions before doing anything:

| File | Size | Inventory share |
| --- | --- | --- |
| `CLAUDE.md` (root) | 6.1 KB | none — well shaped |
| `apps/api/CLAUDE.md` | 33.3 KB | ~28.5 KB (86%) |
| `apps/web/CLAUDE.md` | 13.3 KB | ~10.5 KB (79%) |
| `apps/web/AGENTS.md` | 0.7 KB | pulled in by an `@AGENTS.md` import |

`apps/api/CLAUDE.md`'s `## Architecture` section is 21 KB — 63% of the file — and is a per-file,
per-method narrative rather than an overview. A single bullet about `src/users/` is 7.4 KB. Endpoint
lists appear in three separate places. `## Testing` enumerates every e2e spec and its individual
assertions. `## Database` restates `prisma/schema.prisma` and duplicates `.env.example`.

Useful reference. Not something every session needs resident.

## 4. CLI contract — verified, not assumed

Claude CLI **2.1.237**. Each flag was probed by invoking it with a subcommand; an unknown flag
returns `error: unknown option`, and none of these did. No model requests were made.

| Flag | Status | Relevance |
| --- | --- | --- |
| `--max-turns` | **accepted**, though absent from `--help` | Current usage is correct. Do not "fix" it |
| `--max-budget-usd` | accepted | A hard cap enforced *during* a session — the limiter the loop lacks |
| `--effort` | accepted (`low`/`medium`/`high`/`xhigh`/`max`) | Reviewer effort becomes explicit instead of inherited |
| `--tools` | accepted | Limits the **built-in set**, i.e. availability, not just permission |
| `--disallowedTools` | accepted | Blocks `Task` / `Skill` directly |
| `--disable-slash-commands` | accepted | Disables skills outright |
| `--exclude-dynamic-system-prompt-sections` | accepted | Better prompt-cache reuse across the many sessions a loop spawns |
| `--agents` | accepted (JSON) | An alternative way to define the bounded reviewer |

This settles the open questions in the original investigation: the tooling to scope a session
properly exists, and a real spend cap exists.

## 5. Target responsibilities

**Implementation agent** — read a compact issue packet, implement the acceptance criteria with TDD
and targeted tests, leave the work uncommitted, return a short structured summary. It does not
review, commit, close, open PRs, spawn subagents, call skills, or explore the whole milestone.

**Orchestrator** — record `issueBaseSha`, build the issue packet, run deterministic gates, run a
separate bounded reviewer, apply fail-closed rules, commit, close the issue, verify GitHub state,
checkpoint each stage, and account for usage and rate limits.

**Issue reviewer** — an independent read-only session that receives the exact
`issueBaseSha -> working tree` diff plus the acceptance criteria and gate results, with an explicit
model and effort, returning only `APPROVED` or `BLOCKED` with structured findings. It creates no
issues, changes no files, calls no skills or subagents, and never reads `master...HEAD` or unrelated
phase history.

**Phase reviewer** — unchanged. Opus, read-only code inspection plus `gh issue list/create` for the
existing blocking / nice-to-have workflow. This is the independent backstop and must not be touched.

## 6. Expected saving

The original estimate of 35-55% did not account for the cost of the independent reviewer that
replaces the fork. Corrected arithmetic:

```text
  $2.28  mean today (implementation session, including the /code-review fork)
- $0.70  the self-review fork it no longer spawns
- $0.15  trimmed auto-loaded context
+ $0.40  the new independent bounded issue reviewer
= $1.83  expected, before durability savings
- $0.25  no repeated work after a rate limit, no extra session to close an issue
= $1.58  expected mean, i.e. roughly 30% off
```

Realistic range **25-40%**, target median **at or below $1.50 per issue**. The canary decides.

The fork's share cannot be measured from the current telemetry, because a subagent's cost is folded
into the parent's `total_cost_usd`. The $0.70 above is an estimate; WO-1's telemetry makes it
measurable.

## 7. What must not be traded away

No saving may come from removing or skipping tests, dropping independent review, moving every task to
a weaker model, approving automatically when the reviewer errors, disabling the phase green gate,
merging to `master` automatically, or letting a reviewer edit code.

Two of these deserve emphasis, because the cheapest-looking savings sit right on top of them:

- **Issue-level review must get stronger, not disappear.** See §3 — today's version is self-review
  over the wrong diff with a verdict nobody checks. Replacing it with a bounded independent reviewer
  is a quality improvement that happens to be cheaper.
- **The `/code-review` step and its replacement ship in the same commit.** There must never be a
  revision where issues are implemented with no issue-level review.

## 8. Housekeeping notes found along the way

- The original investigation lived at `docs/ralph-loop-issue-cost.md` — a loose file at the `docs/`
  root, contrary to the root `CLAUDE.md` rule of one folder per feature, and written in Russian,
  contrary to its rule that everything in the repository is English. Both are fixed by this folder.
- `.gitignore` lists `.claude/ralph.iterations.json`, which nothing references any more.
- `apps/web/CLAUDE.md:5` uses an `@AGENTS.md` inline import. This looks like a violation of the root
  rule against `@` imports, but it is a documented exception — the file is auto-regenerated by
  `next dev` and is only 678 bytes. Leave it alone.
- There is no root test runner: `pnpm test` is `pnpm -r run test` and reaches only `apps/api`.
