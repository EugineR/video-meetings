# WO-3 — Durability and context

**Read `plan.md` first for the baseline and the constraints. WO-1 and WO-2 should be merged before
this order starts — the checkpoint below records the stages WO-2 introduces.**

Two independent sources of waste that are not per-issue: work repeated after an interruption, and
context every session pays for whether it needs it or not. Neither changes what a reviewer or a gate
checks, so quality is unaffected.

## Part A — durable state and recovery

### The problem

There is no checkpoint of any kind. Recovery today is re-derivation from git and GitHub, and
`main()` refuses to start unless HEAD is the trunk and the tree is clean.

When the rate limit hit during issue #39, the loop waited **3 hours 35 minutes** for the reset and
then re-ran the whole issue from scratch. The aborted session had already cost $1.83. There is no
mechanism to resume from where it stopped.

Worse, `reviewPhase` has **no rate-limit branch at all**. `handleRateLimit` is called, but a
rate-limited review then fails `sessionOutcome` and throws, ending the entire run. Only `drainIssues`
retries. This gap is not in the original research and must be fixed here.

### State file

Add gitignored runtime state at `.claude/ralph.state.json`:

```json
{
  "schemaVersion": 1,
  "feature": "user-profile-page-and-editing",
  "phase": 3,
  "milestone": "Phase 3: ...",
  "branch": "feature/user-profile-phase-3",
  "issue": 39,
  "issueBaseSha": "...",
  "stage": "ISSUE_REVIEW",
  "reviewRound": 1,
  "commitSha": null,
  "updatedAt": "..."
}
```

Write atomically: temporary file in the same directory, then rename. Add the path to `.gitignore`
alongside the existing Ralph runtime entries. Note `.claude/ralph.iterations.json` is already listed
there but no longer used — remove that stale line.

### Resume rules

| Situation | Action |
| --- | --- |
| No state, clean tree | Start a new issue |
| No state, dirty tree | **Stop.** Never guess |
| State matches the current issue and the expected dirty diff | Resume from the recorded stage |
| HEAD is not what the state expects | **Stop** with diagnostics |
| Commit exists, issue still open | Redo only `CLOSE_ISSUE` and `VERIFY_CLOSED` |
| Issue already closed | Mark done, no model session |
| Gate green, review unfinished | Do not repeat implementation |
| Review approved, no commit | Resume at `COMMIT` |
| Rate limit during review | After reset, repeat the review only |

Note the current startup guard requires a clean tree; resuming mid-issue means the tree is
legitimately dirty. Relax that guard **only** when a valid checkpoint explains the dirt, and keep the
hard stop otherwise.

### Rate limit policy

- Default `onRateLimit` to `stop` until the resume tests pass, then allow `wait` again.
- Waiting must not count as an attempt, but the number of rate-limit resumes must be logged and
  capped.
- Add the missing rate-limit handling to `reviewPhase`.

Clear the state only after a confirmed `VERIFY_CLOSED`.

### Tests

- A rate limit at each stage resumes that exact stage.
- Commit created but close failed: no new model session is started.
- A dirty tree with no state stops the loop.
- Corrupt state stops the loop with a clear error.
- State survives Ctrl-C as a valid checkpoint.
- State is cleared only after a verified close.

## Part B — auto-loaded context

### The problem

Every session in `apps/api` loads **39.4 KB** of instructions before it does anything:

| File | Size | Inventory share |
| --- | --- | --- |
| `CLAUDE.md` (root) | 6.1 KB | none — well shaped, leave it alone |
| `apps/api/CLAUDE.md` | **33.3 KB** | ~28.5 KB (86%) |
| `apps/web/CLAUDE.md` | 13.3 KB | ~10.5 KB (79%) |
| `apps/web/AGENTS.md` | 0.7 KB | pulled in by an `@AGENTS.md` import |

In `apps/api/CLAUDE.md` the `## Architecture` section alone is 21 KB — 63% of the file — and it is
not an overview but a per-file, per-class, per-method narrative. One bullet describing `src/users/`
is 7.4 KB on its own. Endpoint lists appear in three separate places. `## Testing` is a 4.5 KB
enumeration of every e2e spec and its individual assertions. `## Database` is a prose restatement of
`prisma/schema.prisma` plus a duplicate of `.env.example`.

This is useful reference material. It is not something every session needs resident.

### What to do

Keep in the auto-loaded files only what an agent cannot derive by reading the code:

- repository boundaries;
- critical architecture and security invariants (the CQRS convention, "controllers stay thin",
  "cross-module communication goes through the bus");
- the commands, and the targeted-versus-full testing rules;
- language and git rules;
- pointers to the on-demand documents;
- the cross-cutting facts currently buried inside inventories — for example that
  `ALLOWED_MIME_TYPES` and `MAX_SIZE_BYTES` in
  `apps/web/src/components/meetings/RecordingUploader.tsx` must stay in sync with
  `ALLOWED_RECORDING_MIME_TYPES` and `MAX_UPLOAD_SIZE_BYTES` in `apps/api/.env`. That is a rule, and
  it must survive the move. It currently sits inside a single ~1.4 KB inventory bullet, which is
  exactly how such rules get lost.

Move to on-demand docs:

```text
docs/architecture/api.md
docs/architecture/web.md
docs/testing/api.md
docs/testing/web.md
```

Targets: `apps/api/CLAUDE.md` to roughly 5 KB, `apps/web/CLAUDE.md` to roughly 4 KB.

**Leave the `@AGENTS.md` import at `apps/web/CLAUDE.md:5` alone.** It looks like a violation of the
root rule against `@` imports, but it is a documented exception: the file is auto-regenerated by
`next dev`, `apps/web/CLAUDE.md` says so on the next line, and it is only 678 bytes. Removing it
would save nothing and would be undone by the next `next dev`. Mentioned here only so nobody
"fixes" it while trimming the neighbouring file.

### Rules for the move

- No architectural knowledge may be lost — every moved statement stays reachable by a link.
- Reference documents by plain path, never with an `@` prefix.
- Do not duplicate the same inventory across several instruction files.
- Add a lightweight broken-link check.

### Preparing for other providers

Do not implement Codex or Gemini providers here. Just keep the seams clean: canonical project
knowledge, stage prompts, provider CLI invocation, tool-profile translation and usage normalisation
should be separable. Provider-specific filenames must be thin entry points, not the canonical store.

### Verification

- Architectural information is still reachable, just not resident.
- Root and nested instruction files contain no long test matrices or model dumps.
- All links resolve.
- Sizes hit the targets.

## Definition of done

- [x] A stage checkpoint is written atomically and is gitignored.
- [x] A rate limit resumes the current stage instead of repeating the issue.
- [x] `reviewPhase` handles a rate limit instead of ending the run.
- [x] A dirty tree without a valid checkpoint stops the loop.
- [x] State is cleared only after a verified close.
- [x] `apps/api/CLAUDE.md` and `apps/web/CLAUDE.md` are substantially smaller with no knowledge lost.
      33.3 KB -> 7.8 KB and 13.3 KB -> 5.3 KB. Short of the 5 KB / 4 KB targets: what is left is
      rules, boundaries and invariants, and cutting further would have dropped one.
- [x] Every rule that was buried inside an inventory bullet survived the move.
- [x] Links are checked (`pnpm check:links`, run by the pre-commit hook).
- [x] Branching, rollback tags and the human merge gate are unchanged.
