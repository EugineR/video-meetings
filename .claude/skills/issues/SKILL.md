---
name: issues
description: Creates GitHub issues and milestones from a plan file. Use when there is a completed plan with phases and you need to create a backlog on GitHub.
---

# Plan Generator

Read the plan from the file: $ARGUMENTS

For each phase, create a milestone and issues in GitHub using the gh CLI.

## Steps

1. Read the plan file.
2. For each phase, create a milestone: `gh api repos/:owner/:repo/milestones -f title="Phase N: name"`
3. Parse the phase's `**Affects:**` line (e.g. `backend, database` or `frontend`) into one label per listed area. Before creating issues, make sure each of these labels exists in the repo, creating any that are missing: `gh label create "backend" --color "..." [--force]` (skip areas that already exist as labels).
4. For each task in the phase, create an issue with both a type label and one label per area from that phase's `Affects` line: `gh issue create --title "..." --body "..." --label "<type>" --label "<area-1>" [--label "<area-2>" ...] --milestone "..."`

## Issue Format

**Title:** Task text from the plan (without [])
**Body:** Task description
**Labels:**

- Type label: `documentation` for docs-only tasks, `enhancement` for everything else.
- Area label(s): one per value in the phase's `Affects:` line (`backend`, `frontend`, `database`, ...), applied to every task in that phase.
