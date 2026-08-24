---
name: review-all
description: Runs a full code review through three parallel subagents.
---

Run three subagents in parallel using the Task tool:

1. security-reviewer - check the security of changes
2. performance-reviewer - check performance
3. test-coverage-reviewer - check test coverage

Run all three simultaneously. When they're all finished, synthesize the results into a single report.