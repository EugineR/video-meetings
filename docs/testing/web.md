# apps/web — testing reference

`apps/web` has **no automated test suite**: `pnpm test` at the repo root reaches `apps/api`
only, and `package.json` in this workspace configures no test script. A UI change is
verified by hand instead, and the rule that says so is in `apps/web/CLAUDE.md` because it
is binding on every UI change.

> Related: [architecture](../architecture/web.md) · [apps/api testing](./api.md)

## The two required checks

Any UI change (new component, styling change, layout change, etc.) in this app is not considered complete until it has been visually verified using both of the following, in the same turn as the change:

- The `ui-ux-pro-max` skill — to check the change against design/UX guidelines (styles, color, typography, layout, accessibility, etc.).
- The Playwright MCP server (`mcp__playwright__*` tools) — not the `claude-in-chrome` extension — to actually load the page in a browser, interact with it, and check console/network output as needed.

Do not report a UI task as done without having run both checks.

## What to exercise

The app is small enough to walk end to end. The flows below are the ones a UI change can
break; which of them apply depends on what changed (see [architecture](../architecture/web.md)
for what each page renders):

| Route            | Flow                                                                       |
| ---------------- | -------------------------------------------------------------------------- |
| `/register`      | validation messages, password show/hide, duplicate email (409) inline error |
| `/login`         | wrong credentials (401) inline error, redirect to `/` on success            |
| `/`              | spinner until the auth check resolves, redirect to `/login` with no session, "Recent"/"All meetings" lists, upload from a row's modal |
| `/meetings/{id}` | detail render, player vs uploader, the Replace flow, delete confirmation, 404 for an unknown or another user's meeting |

Two things are easy to miss because they are not visible in a happy path: an upload's
progress bar and its Cancel button (`AbortController`, rejecting with
`UploadCancelledError`), and the client-side MIME/size rejection, which must match what
`apps/api` enforces — see the sync rule in `apps/web/CLAUDE.md`.

`apps/api` must be running (`pnpm dev:api`) and reachable at `NEXT_PUBLIC_API_URL`, or
every page renders its inline error state instead of the change under test.
