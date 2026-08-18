# Ralph Loop - Rules for Autonomous Work

## How to Take Issues
- Read the title, body, and done criteria
- Check that the specified branch already exists (if not, create it)
- Work only on this branch - do not create new ones

## Commit Naming

- According to the rules in the skill commit

## Implementation Rules
- Tests first, implementation second (TDD)
- Run tests after each final change
- If tests are red after 5 attempts, stop and write a comment in the Issue describing the problem

## Closing Rules
- Make sure all tests are green
- Make sure all requirements are met
- Run the skill /review for code review
- Close the Issue
- Don't create a PR - Stop Hook will do that
- After closing one Issue, immediately end the session
- Don't take the next Issue yourself
- Stop Hook will automatically start a new session for the next Issue