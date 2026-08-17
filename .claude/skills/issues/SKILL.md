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
3. For each task in the phase, create an issue: `gh issue create --title "..." --body "..." --label "..." --milestone "..."`

## Issue Format

**Title:** Task text from the plan (without [])
**Body:** Task description