---
name: plan-phase
description: Breaks a PRD into implementation phases. Use when there is a completed PRD and you need to create a development plan-phase with independent phases.
---

# Plan Generator

Read the PRD from the file: $ARGUMENTS

Create an implementation plan and save it as `plan.md` in the same feature folder as the PRD (documentation in /docs is grouped per feature — for a PRD at `docs/user-profile-page-and-editing/prd.md` the plan goes to `docs/user-profile-page-and-editing/plan.md`).

## Plan structure:

# Plan: {feature name}

**PRD:** $ARGUMENTS
**Date:** {current date}

## Implementation Phases

### Phase 1: {name}

**Goal:** What this phase delivers
**Affects:** backend / frontend / database
**Tasks:**

- [ ] Task 1
- [ ] Task 2

**Done when:** A specific completion criterion

### Phase 2: {name}

...

## Phase Breakdown Rules:

- Each phase must deliver a working result.
- Phases must be independent; development can stop after any phase.
- The first phase should provide the minimum working path (Tracer Bullet).
- No more than five tasks per phase.
- Backend and frontend work for the same feature must be in separate phases.
- Each phase must include planned tests covering the functionality implemented in that phase.

## Rules

- Read the PRD carefully. The plan must cover all acceptance criteria.
- Do not add tasks that are not specified in the PRD.
- If the PRD is incomplete, ask a question before creating the plan.
