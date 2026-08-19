---
name: issues
description: Creates GitHub issues and milestones from a plan file. Use when there is a completed plan with phases and you need to create a backlog on GitHub.
---

# Plan Generator

Read the plan from the file: $ARGUMENTS

For each phase, create a milestone and issues in GitHub using the gh CLI.

## Steps

1. Read the plan file.
2. For each phase, create a milestone titled `Phase N: name`, and give it a description whose **last line** is `Feature: <key>`, where `<key>` is the name of the feature's folder under `docs/` (e.g. `user-profile-page-and-editing`):

   ```bash
   gh api repos/:owner/:repo/milestones -f title="Phase N: name"      -f description="Goal: ...
   Affects: ...
   Done when: ...
   Feature: <key>"
   ```

   Both parts are load-bearing. The Ralph loop discovers a feature's phases by that
   `Feature:` line and orders them by the `Phase N` prefix — titles alone are ambiguous,
   because separate features each have a "Phase 1". A milestone carrying the marker
   without a `Phase N:` prefix makes the loop stop.
3. Parse the phase's `**Affects:**` line (e.g. `backend, database` or `frontend`) into one label per listed area. Before creating issues, make sure each of these labels exists in the repo, creating any that are missing: `gh label create "backend" --color "..." [--force]` (skip areas that already exist as labels).
4. For each task in the phase, create an issue with both a type label and one label per area from that phase's `Affects` line: `gh issue create --title "..." --body "..." --label "<type>" --label "<area-1>" [--label "<area-2>" ...] --milestone "..."`
5. Finally, close every finished milestone — an open milestone whose issues are all closed, i.e. `open_issues == 0` **and** `closed_issues > 0` (the second condition keeps a freshly created or still-empty milestone open):

   ```bash
   gh api "repos/:owner/:repo/milestones?state=open" \
     --jq '.[] | select(.open_issues == 0 and .closed_issues > 0) | .number' |
     while read -r n; do
       gh api -X PATCH "repos/:owner/:repo/milestones/$n" -f state=closed --jq '"closed #\(.number) \(.title)"'
     done
   ```

   Report which milestones were closed. Never close a milestone that still has open issues.

## Issue Format

**Title:** Task text from the plan (without [])
**Body:** Task description
**Labels:**

- Type label: `documentation` for docs-only tasks, `enhancement` for everything else.
- Area label(s): one per value in the phase's `Affects:` line (`backend`, `frontend`, `database`, ...), applied to every task in that phase.
