# Ralph loop cost reduction — plan

## Why

A Ralph issue costs a median of **$2.02** to implement. Twenty-two issues remain in phases 4-8, so
the current backlog is roughly **$58** of model spend. The research in `research.md` traced that cost
to eight concrete defects in the orchestrator and its prompts, all verified against the code, the
runtime telemetry and the run log.

The goal is to cut the per-issue cost **without weakening review or tests**. Two of the changes below
make quality strictly better than it is today, and the ordering guarantees quality never dips at any
point in the rollout.

## Baseline

Measured from `costUsd` in `.claude/ralph.stats.jsonl` — the `total_cost_usd` field of the `result`
event, which is the only number the current telemetry gets right.

| Metric | Value |
| --- | --- |
| Median cost per issue | **$2.02** (n=10, issues #31-#40) |
| Mean cost per issue | $2.28 |
| Phase review (Opus) | $1.23 per session (n=5) |
| Total observed | $28.93 |
| Remaining backlog | 22 issues, phases 4-8, about **$58** |

Do **not** use the token counters as a metric. They are wrong in both directions: issue #40 recorded
156 "turns" under a `--max-turns 100` cap and 15.6M "input tokens" against a 6M `issueBudgetTokens`
cap that never fired. `research.md` §3 explains why.

## Target

Median **at or below $1.50 per issue**, measured the same way, with no regression on the quality
guard below.

The honest arithmetic, from the baseline:

```text
  $2.28  mean today (implementation session, including the /code-review fork)
- $0.70  the self-review fork it no longer spawns
- $0.15  trimmed auto-loaded context
+ $0.40  the new independent bounded issue reviewer
= $1.83  expected, before durability savings
- $0.25  no repeated work after a rate limit, no extra session to close an issue
= $1.58  expected mean, i.e. roughly 30% off
```

That is **25-40%**, not the 35-55% first estimated: the earlier figure did not subtract the cost of
the reviewer this plan adds. The canary settles it.

## Work orders

Three independent orders, in this sequence. Each is self-contained — an agent executing one does not
need to read the other two.

| Order | File | Changes agent behaviour? | Effect on quality |
| --- | --- | --- | --- |
| WO-1 | `work-order-1-measurement.md` | No | None — measurement only |
| WO-2 | `work-order-2-issue-review.md` | Yes | **Up** |
| WO-3 | `work-order-3-durability.md` | Yes | None — recovery and context |

**WO-1 first, deliberately.** It changes nothing an agent does; it makes the loop measurable and adds
the first real spending cap. Without it there is no trustworthy before/after number for WO-2.

**WO-2 is where both the savings and the quality gain are.** It replaces self-review with independent
review. The two halves ship in one commit — see below.

**WO-3 removes waste that is not per-issue**: repeated work after a rate limit, and 28 KB of
auto-loaded context that every session pays for.

## Quality must not regress

Today's issue-level review is **self-review**, and it is weaker than it looks:

- `.claude/ralph.md` tells the implementing session to run `/code-review` on **its own diff**, inside
  its own context, with its own reasoning in view.
- It read the wrong range. The log shows it writing `master_diff_review.txt` and
  `working_diff_review.txt` — the whole `master...HEAD` diff rather than the issue's own ~11 KB.
- Its verdict binds nothing. `ralph-start.js` has no issue-level verdict check; if the fork crashed,
  the session committed and closed the issue regardless.
- There is no per-issue deterministic gate. `runGreenGate()` runs `pnpm lint && pnpm test` once per
  *phase*, after every issue is already committed.

WO-2 is stronger on all four counts: an independent read-only session, scoped to the exact issue
diff, with an explicit verdict the orchestrator enforces fail-closed, plus a real per-issue gate.

### Rollout rule

The `/code-review` step is removed from `.claude/ralph.md` **in the same commit** that adds the
independent reviewer. There must never be a revision in which issues are implemented with no
issue-level review at all.

### Canary pass criteria

A canary phase passes only if **every** one of these holds:

- Blocking defects found per issue is **at or above** the baseline rate. Finding fewer defects is a
  regression signal, not a saving.
- The Opus phase review is unchanged and still runs.
- The per-issue gate ran and was green before every commit.
- No `Skill` or `Agent` call appears in an implementation or reviewer session.
- The reviewer's diff range starts at `issueBaseSha`, never at `master`; no `*_diff_review.txt` or
  similar scratch artifacts are written into the repository.
- A crashed, empty, or unreadable review is treated as a failure, never as an approval.
- Median cost per issue is at or below $1.50.

## Constraints that apply to every work order

- Orchestrator tests must not call the real Claude CLI, GitHub, or push. Use the fake command runner.
- Do not start a real paid Ralph run without explicit approval. `--dry-run` and the fake provider are
  always allowed.
- Never weaken a gate to gain speed: no skipped tests, no auto-approval on reviewer error, no
  automatic merge to `master`, no reviewer that can edit code.
- Small, revertable commits. Do not push unless asked.
- Everything written into the repository is in English, per the root `CLAUDE.md`.

## Reference

- `research.md` — the full investigation: measured evidence, the eight defects, and the target
  architecture.
- `../ralph-loop-rework/plan.md` — the design of the current loop.
- `../ralph-loop-rework/usage.md` — the developer guide.

## Commit granularity

Small and revertable, one logical step each. Suggested sequence — the messages are not binding, the
size is:

1. `test(ralph): add stream and command-runner fixtures`
2. `refactor(ralph): extract usage parsing and main entrypoint`
3. `fix(ralph): record deduplicated usage metrics`
4. `fix(ralph): apply the issue budget to closed issues`
5. `feat(ralph): cap session spend and set effort per stage`
6. `feat(ralph): add bounded issue review and per-issue gate`
7. `refactor(ralph): move commit and issue closure to orchestrator`
8. `feat(ralph): persist issue stage checkpoints`
9. `docs: move detailed agent context to on-demand guides`
10. `docs(ralph): document the cost-efficient pipeline and recovery`

Tests must be green after each. Do not push without being asked.

## Documentation to update

Whichever work order changes behaviour also updates the docs in the same change:

- the new issue state machine, and how issue review differs from phase review;
- where the checkpoint lives and how resume behaves after a limit or Ctrl-C;
- which metrics are gross, cached and cost-equivalent;
- how to enable the browser tool profile;
- why the implementing agent no longer commits or closes;
- how to diagnose a fail-closed stop;
- how to archive the legacy v1 stats once the comparison is done.

Root `CLAUDE.md` and `../ralph-loop-rework/usage.md` both describe the loop and will need edits.

## Metrics to compare, baseline versus canary

- API requests per issue;
- cache creation and cache read split;
- cost per issue;
- implementation duration and issue-review duration;
- fork/subagent count;
- tool calls per stage;
- extra sessions caused by a failed commit or close;
- gate and review failure counts;
- **blocking defects found by issue review and by phase review**.

The last one is the one that decides whether the change was worth making. A cheaper loop that finds
fewer real defects has not succeeded.

## What each work order reports back

On completion, state:

1. the files changed;
2. the tests added and their results;
3. which old settings stayed backward compatible;
4. what still needs a real canary run;
5. explicitly, that no real Ralph or Claude session was run and nothing was pushed;
6. known risks and the rollback path;
7. for WO-2, the before/after cost measurement.
