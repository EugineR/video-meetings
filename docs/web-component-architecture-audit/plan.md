# Plan: Web component architecture audit and refactor

**PRD:** `docs/web-component-architecture-audit/prd.md`
**Date:** 2026-08-28

## How this plan is verified

`apps/web` has no unit-test runner, and the PRD puts test infrastructure out of scope. The
project's own convention for verifying a web change therefore applies to every phase below: the
Playwright MCP server for the real browser walk-through, and the `ui-ux-pro-max` skill for
anything that changes what the user sees (`apps/web/CLAUDE.md`, `docs/testing/web.md`). Each
phase names the flows it must exercise; a phase is not done until they pass.

Every phase also ends green on `pnpm lint:web`, `pnpm --filter web exec tsc --noEmit` and
`pnpm build:web`, and — per the root `CLAUDE.md` rule that architecture changes update their
documentation in the same change — updates `docs/architecture/web.md` and any `apps/web/CLAUDE.md`
rule it invalidates. Phase 10 is not "the phase where docs get written"; it is the phase that adds
the preventive rules and their lint enforcement on top.

Phases are ordered so nothing is written twice: the query layer (4–5) lands before the callback
contracts (8), because the section callbacks become cache updates and would otherwise be
restructured in both phases.

---

## Implementation Phases

### Phase 1: Layout-owned shell, header and auth guard

**Goal:** The app shell, header and authenticated-user guard exist once, in layouts, instead of
being re-declared in six pages. Fixes the missing avatar on `/meetings/{id}`.
**Affects:** frontend (`apps/web`)
**Tasks:**

- [ ] Introduce route groups: `(app)` for `/`, `/meetings/[id]`, `/profile`, `/profile/edit`;
      `(auth)` for `/login`, `/register`.
- [ ] Move the gradient shell, `AppHeader` and the `max-w-2xl` content container into
      `(app)/layout.tsx`, and the shell plus the `max-w-md` card slot into `(auth)/layout.tsx`;
      strip all of it from the six page files.
- [ ] Move the `if (!user) return <Spinner/>` guard into `(app)/layout.tsx` and delete the four
      copies.
- [ ] Resolve the auth-group header: replace the prop-less `<AppHeader />` on login/register with
      a brand-only header component or an explicitly named empty variant.
- [ ] Add `(app)/error.tsx` rendering a recoverable error state.

**Done when:** No file under `src/app/` renders `AppHeader`; the shell gradient string and the
`!user` guard each appear in exactly one file; `/meetings/{id}` shows the avatar and name in the
header like the other three authenticated pages.

**Verification:** Playwright walk of `/login` → `/register` → sign in → `/` → `/meetings/{id}` →
`/profile` → `/profile/edit` → sign out, confirming the header is identical on all authenticated
routes and the avatar is present on the meeting page. `ui-ux-pro-max` review of the header and
both shells. Console clean of hydration warnings.

---

### Phase 2: Domain logic out of components into `src/lib/`

**Goal:** Pure functions and constants stop living at the top of JSX files, and the duplicated
ones collapse to one definition.
**Affects:** frontend (`apps/web`)
**Tasks:**

- [ ] Move `formatFileSize` (from `RecordingCard.tsx`) and `parseParticipants` (from
      `CreateMeetingModal.tsx`) into `src/lib/`.
- [ ] Move `EMAIL_PATTERN` into `src/lib/` and delete the duplicate definition — it is currently
      declared verbatim in both `login/page.tsx` and `register/page.tsx`.
- [ ] Move `initialsFrom` / `getInitials` out of `UserAvatar.tsx` into `src/lib/`.
- [ ] Create `src/lib/uploads.ts` holding the recording and avatar MIME allowlists, size caps and
      their display labels; import them in `RecordingUploader.tsx` and `AvatarSection.tsx`.
- [ ] Rewrite the `apps/web/CLAUDE.md` rule that names those two component files as the mirror of
      the API's allowlist, so it points at `src/lib/uploads.ts`.

**Done when:** `formatFileSize`, `parseParticipants`, `EMAIL_PATTERN` and `getInitials` are each
defined once, in `src/lib/`; no component file declares an upload MIME type or size constant.

**Verification:** Playwright: submit an invalid email on login and on register (same message from
the same pattern); upload an over-size and a wrong-type file to both the recording uploader and
the avatar picker, confirming the client-side rejection messages are unchanged; check a recording
card still renders its file size. No visual change expected — this phase is behaviour-preserving.

---

### Phase 3: Shared display primitives and the `ui/` layer

**Goal:** The inline markup repeated across the app becomes named components in one place.
**Affects:** frontend (`apps/web`)
**Tasks:**

- [ ] Create `src/components/ui/` and add `ErrorText` (`role="alert"`) and `SuccessText`
      (`role="status"`).
- [ ] Replace all 12+ hand-written `<p className="text-sm text-danger" role="alert">` occurrences
      and both `role="status"` occurrences with them.
- [ ] Add `LoadingState` and replace the centered-spinner blocks, settling the currently divergent
      paddings and `aria-label` values on one behaviour.
- [ ] Relocate `UserAvatar` out of `components/profile/` — `components/layout/AppHeader` imports it
      today, which points a shared dependency into a feature folder.
- [ ] Update `docs/architecture/web.md` with the `ui/` layer and the new `UserAvatar` location.

**Done when:** `grep -r 'text-sm text-danger' src/` returns only the `ErrorText` primitive, and no
feature folder is imported by `components/layout/`.

**Verification:** Playwright: trigger one error state per surface (bad login credentials, meetings
list failure via offline, recording delete failure, avatar upload rejection) and both success
states on `/profile/edit`, confirming wording, colour and screen-reader roles are unchanged.
`ui-ux-pro-max` review of the error/success/loading states as a set — this phase is where three
slightly different spinner treatments become one, so the change must be deliberate.

---

### Phase 4: Query layer foundation and the profile query

**Goal:** One `GET /users/me` per session instead of one per page mount, and
`useAuthenticatedUser`'s three responsibilities pulled apart.
**Affects:** frontend (`apps/web`)
**Tasks:**

- [ ] Add `@tanstack/react-query` and mount `QueryClientProvider` in the root layout; record the
      new dependency in the root `CLAUDE.md` and `README.md` in the same change.
- [ ] Turn the profile fetch into a cached query consumed by the header, `/profile` and
      `/profile/edit`.
- [ ] Reduce `useAuthenticatedUser` to the token/redirect concern only (the guard itself now lives
      in the Phase 1 layout), keeping the `localStorage`-is-client-only constraint handled without
      introducing a hydration mismatch.
- [ ] Convert `applyProfile` and `applyAccessToken` from hook-local state setters into
      `setQueryData` cache updates.
- [ ] Update `apps/web/CLAUDE.md`, which currently describes `useAuthenticatedUser()` as the shared
      guard and the only place the profile is fetched.

**Done when:** Navigating `/` → `/profile` → `/` issues at most one `GET /users/me` for the
session, and the header no longer flickers from initials to avatar on each navigation.

**Verification:** Playwright with the network panel: count `/users/me` requests across the
navigation cycle above. Then save a display name and confirm the header updates without a refetch;
upload and remove an avatar and confirm the same; change the password and confirm the session
survives on the reissued token. Reload each authenticated route directly to confirm no hydration
mismatch appears in the console.

---

### Phase 5: Meeting queries, polling and page slimming

**Goal:** The meetings list and meeting detail move onto queries, and the meeting page stops
hosting a state machine.
**Affects:** frontend (`apps/web`)
**Tasks:**

- [ ] Convert the meetings list fetch on `/` to a query; make create-meeting and
      upload-from-a-row update the cache instead of hand-patching local state.
- [ ] Convert the meeting detail fetch to a query and drive polling from `refetchInterval` using
      the existing "any recording pending or summary not caught up" predicate.
- [ ] Replace the `pollGenerationRef` stale-response guard with query invalidation after upload and
      delete.
- [ ] Extract the summary-reconciliation logic (`recordingsSignature`,
      `reconciledRecordingsSignature`, `isSummaryPending`, `showSummarySection`) into a dedicated
      hook, preserving the documented reasons each rule exists.
- [ ] Update `docs/architecture/web.md` for the query layer and the new hook.

**Done when:** `meetings/[id]/page.tsx` is under 120 lines and contains no polling or
summary-reconciliation logic; no component fetches through a `useEffect`.

**Verification:** Playwright, the full recording lifecycle: upload a video and an mp3 to one
meeting, watch each transition `UPLOADED` → `PROCESSING` → `READY` without a manual reload, watch
the summary appear and then re-enter its updating state when the second recording completes; then
delete a recording and confirm the summary is treated as pending again rather than trusted. Also
delete the meeting's only recording, and confirm polling stops once everything is terminal (no
request storm in the network panel). Confirm a 404 on an unknown meeting still renders inline.

---

### Phase 6: One form convention

**Goal:** All five forms validate, report errors and show pending state the same way.
**Affects:** frontend (`apps/web`)
**Tasks:**

- [ ] Choose the convention among the three in use today (manual state in `CreateMeetingModal`,
      uncontrolled `FormData` on login/register, controlled `TextField` in the profile sections)
      and record the choice with its rationale.
- [ ] Add a `PasswordField` primitive (`TextField` + `InputGroup` + eye toggle), shaped to the
      chosen convention, and use it in login, register and all three `PasswordSection` inputs.
- [ ] Migrate `CreateMeetingModal` onto the convention, deleting its manual `titleError` /
      `dateError` state and its raw `Label htmlFor` + `Input id` wiring.
- [ ] Give field-level API errors an explicit mechanism, and remove `PasswordSection`'s regex match
      on the API's `current password is incorrect` message text.
- [ ] Migrate the remaining forms onto the convention.

**Done when:** The password field with its eye toggle is written once; every form uses the same
validation and error-display mechanism; no code path identifies an API error by matching message
text.

**Verification:** Playwright, every form's failure and success paths: empty and malformed submits
on login/register; empty title and empty date on create-meeting; wrong current password, too-short
new password and mismatched confirmation on password change; over-length display name. Confirm
error placement, focus behaviour and the pending label are identical across all of them, that the
eye toggle works and is labelled in all five places, and that closing the create-meeting modal
resets it. `ui-ux-pro-max` review of the unified form treatment.

---

### Phase 7: Upload logic consolidation

**Goal:** The near-identical file-selection, validation and progress logic in the two uploaders
becomes one implementation.
**Affects:** frontend (`apps/web`)
**Tasks:**

- [ ] Extract the shared piece — hidden `<input>`, staged file, `validateFile`, object-URL
      lifecycle, progress and cancellation — into a `FileDropzone` component or a
      `useFileSelection` hook parameterized by the Phase 2 constants.
- [ ] Rebuild `RecordingUploader` on it, keeping drag-and-drop and the abort control.
- [ ] Rebuild `AvatarSection` on it, keeping stage-then-Save (selection must not upload on its own)
      and the preview.
- [ ] Confirm `UploadCancelledError` still short-circuits before any error state is shown, and that
      `uploadMeetingRecording` stays on `XMLHttpRequest`.

**Done when:** `validateFile` and the guard against a second file arriving mid-upload exist once
each; both uploaders consume the same module.

**Verification:** Playwright: drag-and-drop and click-to-pick a recording; cancel an upload
mid-flight and confirm no error is rendered; pick a second file during an in-flight upload and
confirm it is ignored; reject an over-size and a wrong-type file in both uploaders. For the avatar:
select a file and confirm nothing uploads until Save, cancel a staged selection and confirm the
previous avatar returns, then Save and confirm the header updates. Check the console for leaked
object URLs after cancelling.

---

### Phase 8: Component contracts and code conventions

**Goal:** Components that do the same thing expose the same API, and the codebase stops carrying
three conventions for the same decision.
**Affects:** frontend (`apps/web`)
**Tasks:**

- [ ] Unify the "saved, here is the result" callbacks — today `onSaved(Profile)`,
      `onProfileChange(Partial<Profile>)` and `onChanged(accessToken)` — on one name and payload
      shape.
- [ ] Give `onUploaded` one meaning; it is `(recording: Recording)` in `RecordingUploader` and
      `UploadRecordingModal` but `(meetingId: string)` in `MeetingRow`.
- [ ] Replace the two inline confirmations (`RecordingCard` delete, `AvatarSection` remove) with one
      `ConfirmModal`, and standardize modal props across all modals.
- [ ] Apply one `'use client'` and prop-ordering convention; `AppHeader`, `UserAvatar`,
      `RecordingStatusChip` and `MeetingSummarySection` omit the directive today while siblings
      declare it.
- [ ] Settle the two open placement questions — where single-page section components live, and
      `@/components/...` versus relative sibling imports — and apply the answer.

**Done when:** One callback convention across the section and modal components; one confirmation
component; one import convention; one `'use client'` rule.

**Verification:** Playwright: delete a recording (confirm and cancel), remove an avatar (confirm
and cancel), and confirm each modal closes on backdrop, on Escape and on its close control, that
focus returns to the trigger, and that an error raised inside a confirmation is shown in the modal
rather than behind it. Re-run the display-name, password and avatar save paths to confirm the
renamed callbacks still propagate to the header.

---

### Phase 9: Interaction and accessibility corrections

**Goal:** The wrong-element-for-the-job cases are fixed and touch targets come from one mechanism.
**Affects:** frontend (`apps/web`)
**Tasks:**

- [ ] Rebuild `MeetingRow`, which today nests a HeroUI `Button` alongside a raw
      `<button onClick>` wrapping the row content, as a proper link/card pattern using `onPress`.
- [ ] Replace `RecordingCard`'s `href`-less `<Link onPress>` with a button.
- [ ] Consolidate the three touch-target expressions — `h-11 md:h-10` (~20 call sites),
      `size="lg"`, and `min-h-[44px] md:min-h-10` — into one mechanism.
- [ ] Correct heading order: `AppHeader` renders the brand as `<h1>` while `/profile/edit` opens
      with `<h2>` and other pages start at `Card.Title`.

**Done when:** No interactive element is nested inside another; touch-target sizing is not
hand-written at call sites; each page has one coherent heading outline.

**Verification:** Playwright: tab through the meetings list and a recording card confirming a
single, correct stop per control and that Enter/Space activate what they should; open a recording
from its card by keyboard. Measure rendered control heights at a mobile viewport (44px) and desktop
(40px). `ui-ux-pro-max` accessibility review of the meetings list, recording card and header,
including the heading outline and contrast on the touched controls.

---

### Phase 10: Preventive documentation and lint enforcement

**Goal:** The conventions this refactor established are written down and, where checkable,
enforced — so the duplication does not accumulate again.
**Affects:** frontend (`apps/web`), documentation, tooling
**Tasks:**

- [ ] Add the eight preventive rules from the PRD to `apps/web/CLAUDE.md`: shell/header/guard belong
      to the layout; `ui/` is the only home for shared primitives and feature folders do not import
      each other; upload constants live in `src/lib/uploads.ts`; one form convention; API errors are
      never matched by message text; touch-target sizing comes from the shared mechanism; data
      fetching goes through the query layer; one import convention.
- [ ] Sweep `apps/web/CLAUDE.md`, `docs/architecture/web.md` and `docs/testing/web.md` for any
      statement the refactor made false, and confirm the file inventory matches the new structure.
- [ ] Add the ESLint rules that make the checkable conventions fail at lint time:
      `no-restricted-imports` for cross-feature imports and for a page importing `AppHeader`,
      `no-restricted-syntax` for the raw `text-sm text-danger` string.
- [ ] Verify each new lint rule by introducing a violation deliberately, confirming
      `pnpm lint:web` fails, then reverting it.
- [ ] Run `pnpm check:links` and confirm every markdown link and backticked `.md` path added by this
      work resolves.

**Done when:** `apps/web/CLAUDE.md` states every preventive rule; no documentation file describes
the pre-refactor structure; the mechanically checkable rules fail the lint run when violated.

**Verification:** Full regression pass of every flow in `docs/testing/web.md` with Playwright —
register, login, create meeting, upload video and mp3, transcription and summary settling, delete
recording, edit display name, change password, upload and remove avatar, sign out — plus
`pnpm lint:web`, `pnpm --filter web exec tsc --noEmit`, `pnpm build:web` and `pnpm check:links`.
This is the phase where the whole app is walked end to end, not just the surface each earlier phase
touched.
