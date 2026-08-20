# WO-1 — Measurement and guardrails

**Read `plan.md` first for the baseline and the constraints. You do not need the other work orders.**

This order changes **nothing** about what an implementing agent does. It makes the loop measurable
and gives it its first real spending cap. It ships first so that WO-2 has a trustworthy before/after
number.

Everything here is in `.claude/ralph-start.js` (1260 lines, CommonJS) plus a new test directory.

## 1. Make the orchestrator importable

`ralph-start.js:1260` ends with a bare `main().catch(...)`. Requiring the file today parses
`process.argv`, calls GitHub, and can mutate git state — so none of it can be unit tested.

- Guard the entry point with `require.main === module`.
- Export the pure helpers the tests need: the stream parser, `readVerdict`, `sessionOutcome`,
  the row builder inside `recordStats`, `estimateIssueTokens`, `fillPrompt`, `phaseTag`,
  `describeTool`, `fmtTokens`, `fmtDuration`.
- Do not reorganise the file beyond what the export requires. This is a plumbing change.

**Acceptance:** requiring the module starts no process, makes no network call and touches no file.
`node .claude/ralph-start.js --dry-run` behaves exactly as before.

## 2. Test harness

There is no root test runner today: `pnpm test` is `pnpm -r run test`, which reaches only `apps/api`
(Jest). Orchestrator tests need their own wiring.

- Use the built-in `node:test` — no new production dependency. Node is pinned to >= 20 and the local
  runtime is v22.
- Put tests in `.claude/tests/`.
- Add a root script `test:ralph` running `node --test .claude/tests/`.
- Add `pnpm test:ralph` to `.husky/pre-commit`, which currently runs `pnpm lint && pnpm test`. Keep
  it a separate script rather than folding it into `pnpm test`, so `pnpm -r` stays app-only.

### Fixtures

Capture or hand-write `stream-json` fixtures covering:

- several `assistant` events sharing one `message.id`;
- a final `result` event carrying aggregate `usage`, `num_turns` and `total_cost_usd`;
- a `rate_limit_event`;
- a `result` with `permission_denials`;
- subagent/fork-shaped events;
- a malformed line in the middle of the stream.

### Fake command runner

`exec()` calls `spawnSync` directly and `runSession` calls `spawn` directly, both hard-wired to real
`git` / `gh` / `pnpm` / `claude`. Introduce an injectable runner so tests can supply fakes. Keep the
default behaviour identical when nothing is injected.

**Acceptance:** the whole suite runs with no network, no Claude login, no GitHub auth and no Postgres.

## 3. Telemetry v2

The current parser (`ralph-start.js:513-520`) counts every `assistant` event as a turn and sums
`input_tokens`, `cache_creation_input_tokens` and `cache_read_input_tokens` at face value on each
one. The result is wrong in both directions — issue #40 logged 156 turns under a `--max-turns 100`
cap, and its `outputTokens` reads 743 for a session that cost $4.42.

Prefer the aggregate on the final `result` event, which the parser currently ignores except for
`total_cost_usd`.

Source priority:

1. aggregate `usage` and `num_turns` from the `result` event, when present;
2. otherwise usage de-duplicated by `message.id`;
3. otherwise the current best-effort sum, explicitly marked as estimated.

Keep the old per-event counter as `assistantEvents` and the real request count as a separate field —
the old counter is still useful for the live progress line.

New row shape, written by `recordStats`:

```json
{
  "schemaVersion": 2,
  "kind": "impl|issue-review|repair|phase-review",
  "phase": "...",
  "issue": 39,
  "stage": "IMPLEMENT",
  "model": "sonnet",
  "effort": "high",
  "assistantEvents": 0,
  "apiRequests": 0,
  "inputTokens": 0,
  "cacheCreationInputTokens": 0,
  "cacheReadInputTokens": 0,
  "grossInputTokens": 0,
  "outputTokens": 0,
  "costUsd": 0,
  "usageQuality": "result|deduplicated|estimated",
  "durationMs": 0,
  "terminalReason": "completed",
  "exitCode": 0,
  "rateLimitType": null,
  "rateLimitResetsAt": null
}
```

`inputTokens` now means API `input_tokens` only. The old all-three sum lives in `grossInputTokens`.

**Backward compatibility:** the 19 existing v1 rows must stay readable for reporting, marked as
legacy/estimated. Never average a v1 `inputTokens` together with a v2 one as if they were the same
quantity.

## 4. Fix the budget check

`ralph-start.js:884` checks the per-issue budget, but `ralph-start.js:859` runs
`if (closed) { ...; continue; }` first — so a successfully closed issue is never checked. Issue #40
burned 15.6M against a 6M cap and the loop said nothing.

Move the check so it also runs on the closed path. This is a small change and belongs in its own
commit.

While here: `reviewPhase` accumulates the phase token total but never checks it. Decide deliberately
whether the phase cap should apply to review rounds, and write down the answer.

## 5. Use the CLI's own caps

Verified on Claude CLI **2.1.237**. Each flag below was probed with a subcommand invocation; an
unknown flag returns an "unknown option" error, and none of these did. No model requests were made.

| Flag | Use |
| --- | --- |
| `--max-budget-usd` | A hard cap enforced *during* the session. Today nothing stops a runaway — every check is post-mortem. Set it per stage from the config. |
| `--effort` | Levels `low`, `medium`, `high`, `xhigh`, `max`. Makes effort explicit per stage instead of inherited. |
| `--exclude-dynamic-system-prompt-sections` | Moves cwd, env info and git status out of the system prompt, improving prompt-cache reuse across the many sessions a loop spawns. Free win. |

Note: **`--max-turns` is accepted** even though it is absent from `--help` in this version. The
current `--max-turns 100` usage is correct — do not "fix" it, and do not lower it until v2 telemetry
has produced a real request-count distribution.

Config additions (names may be adapted, semantics may not):

```json
{
  "implMaxCostUsd": 3.0,
  "issueReviewMaxCostUsd": 1.0,
  "phaseReviewMaxCostUsd": 3.0,
  "implEffort": "medium",
  "reviewEffort": "high"
}
```

Set the initial caps generously — roughly the observed P90 plus 30% — so they catch runaways without
failing healthy sessions. Tighten after WO-2's canary.

## 6. Report in dollars

`estimateIssueTokens()` and `printPlan()` drive `--dry-run`, and both speak in the broken token unit.
Switch them to cost: median cost per issue, projected cost per phase, projected cost per run. When
the estimate rests on legacy v1 rows, say so in the output.

The live progress line and the end-of-run summary should lead with cost and duration, not with the
misleading turn count.

## Tests for this order

- Repeated `assistant` events sharing a `message.id` count as one request.
- `cache_read_input_tokens` never lands in `inputTokens`.
- Aggregate `result` usage wins over per-event accumulation.
- A malformed line does not abort parsing.
- Legacy v1 rows load, and are marked rather than silently mixed with v2.
- A closed issue over its budget is caught.
- The fake CLI argv contains the cost cap, the effort and the stage's model.
- `--dry-run` writes nothing to git or GitHub.

## Definition of done

- [ ] Importing the module has no side effects; `--dry-run` is unchanged.
- [ ] `pnpm test:ralph` passes offline and runs in pre-commit.
- [ ] Usage is no longer re-summed per assistant content event.
- [ ] Stats rows split input, cache creation, cache read, output and cost, and carry a schema version.
- [ ] Legacy rows are readable and explicitly marked.
- [ ] The per-issue budget applies to closed issues too.
- [ ] Every session is launched with an explicit cost cap and effort.
- [ ] `--dry-run` reports dollars.
- [ ] No behavioural change to implementation, review, branching or the merge gate.
