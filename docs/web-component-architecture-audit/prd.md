# PRD: Web component architecture audit and refactor

**Date**: 2026-08-28
**Status**: Draft

## Goal

`apps/web` grew page by page, and the result is a codebase that reads as six variations on
a theme rather than one system: the app shell and `AppHeader` are re-declared by hand in every
page, the authenticated-user guard is copy-pasted four times, upload validation exists twice in
two components, forms are written three different ways, and the same "save succeeded" callback
has three different names and three different signatures. This refactor consolidates those into
a layout-owned shell, a shared UI primitive layer, a single form and data-fetching convention,
and a feature-oriented folder structure — so the frontend is presentable as portfolio work and
so a new page can be added without copying an existing one.

## Scenario

- User opens any authenticated page -> the header, page background and content container come
  from a route-group layout, identical on every route, rather than from per-page JSX
- User navigates `/` -> `/meetings/{id}` -> the header keeps showing their avatar and name
  (today the meeting page passes only `email`, so the avatar silently disappears)
- User navigates between authenticated pages -> the profile is served from a client-side cache,
  not refetched with a fresh `GET /users/me` on every mount, and the header does not flicker
  from initials to avatar on each navigation
- User signs in on a phone -> every interactive control meets the 44px touch target through one
  shared mechanism, not through three different hand-written class conventions
- User submits any form in the app (login, register, create meeting, display name, password)
  -> validation errors, pending state and error messages look and behave identically
- Developer adds a new authenticated page -> writes only the page's own content; shell, header,
  auth guard and loading state are inherited
- Developer changes the recording upload size limit -> edits one module, not two component files
  that each carry their own copy of the constants and their own `validateFile`

## In scope

### 1. Layout and route structure

- Introduce App Router route groups: `(app)` for authenticated routes (`/`, `/meetings/[id]`,
  `/profile`, `/profile/edit`) and `(auth)` for `/login` and `/register`.
- `(app)/layout.tsx` owns the page shell currently duplicated across six files: the
  `min-h-screen` gradient background wrapper, `AppHeader`, and the centered
  `max-w-2xl` content container. Pages render content only.
- `(auth)/layout.tsx` owns the auth shell: the same background plus the centered
  `max-w-md` card slot.
- Move the auth guard into `(app)/layout.tsx`. The `if (!user) return <Spinner/>` block,
  currently identical in `page.tsx`, `meetings/[id]/page.tsx`, `profile/page.tsx` and
  `profile/edit/page.tsx`, exists once.
- Add `error.tsx` for the `(app)` group so an unhandled render error shows a recoverable
  error state instead of the Next.js dev overlay / a blank production page.
- Decide and document the header's role on `/login` and `/register`: today they render
  `<AppHeader />` with no props, producing a header with a sign-out slot and user slot both
  empty. Either give the auth group a dedicated brand-only header component, or make the
  empty state an explicit, named variant.

### 2. Data layer (TanStack Query)

- Add `@tanstack/react-query` and a `QueryClientProvider` in the root layout.
- Replace the hand-rolled fetching in `useAuthenticatedUser`, `page.tsx` (meetings list) and
  `meetings/[id]/page.tsx` (meeting detail) with queries. The `cancelled` flag pattern and the
  manual `.then/.catch` + `useState` triples go away.
- The profile (`GET /users/me`) becomes a single cached query shared by the header, `/profile`
  and `/profile/edit`, instead of one fetch per page mount.
- Split `useAuthenticatedUser`'s three current responsibilities: the redirect guard moves to
  the `(app)` layout, the profile fetch becomes a query, and `applyAccessToken` /
  `applyProfile` become cache updates (`setQueryData`) rather than hook-local state setters.
- The meeting page's polling moves to the query's `refetchInterval`, driven by the existing
  "any recording pending or summary not caught up" predicate. The `pollGenerationRef`
  stale-response guard is replaced by query invalidation after upload/delete.
- `src/lib/api.ts` stays the only module that talks to `apps/api` — queries call into it, they
  do not call `fetch` themselves.

### 3. Shared UI primitives

Create `src/components/ui/` and extract the markup currently repeated inline:

- `ErrorText` — replaces the 12+ hand-written `<p className="text-sm text-danger" role="alert">`.
- `SuccessText` — replaces the `role="status"` variant in `DisplayNameSection` and
  `PasswordSection`.
- `PasswordField` — the `TextField` + `InputGroup` + eye-toggle `Button` block, currently
  written out four times (login, register, and three times inside `PasswordSection`).
- `LoadingState` — the centered spinner block, currently repeated with three different
  paddings and three different `aria-label` values.
- `FileDropzone` or a shared `useFileSelection` hook — `RecordingUploader` and `AvatarSection`
  contain near-identical `validateFile`, hidden-`<input>`, staged-file and progress logic.

### 4. Domain logic out of components

Move into `src/lib/`:

- `formatFileSize` (currently top of `RecordingCard.tsx`)
- `parseParticipants` (currently top of `CreateMeetingModal.tsx`)
- `EMAIL_PATTERN` (currently duplicated verbatim in `login/page.tsx` and `register/page.tsx`)
- `initialsFrom` / `getInitials` (currently in `UserAvatar.tsx`)
- `ALLOWED_MIME_TYPES` / `MAX_SIZE_BYTES` for both recordings and avatars into one
  `src/lib/uploads.ts`, so the mirror of the API's allowlist documented in
  `apps/web/CLAUDE.md` lives in one module instead of inside two component files.

### 5. Consistent component contracts

- Unify the "saved, here is the result" callbacks. Today: `DisplayNameSection.onSaved`
  takes a full `Profile`, `AvatarSection.onProfileChange` takes a `Partial<Profile>`, and
  `PasswordSection.onChanged` takes an `accessToken` string. One naming and payload
  convention across all three.
- Unify `onUploaded`, which today means `(recording: Recording) => void` in
  `RecordingUploader` and `UploadRecordingModal` but `(meetingId: string) => void` in
  `MeetingRow`.
- Standardize modal props (`isOpen` / `onOpenChange` / result callback) across
  `CreateMeetingModal`, `UploadRecordingModal`, `RecordingPlayerModal` and the two inline
  confirmation modals in `RecordingCard` and `AvatarSection`. The two inline delete/remove
  confirmations become one shared `ConfirmModal`.
- Apply one prop-ordering and `'use client'` convention: today `AppHeader`, `UserAvatar`,
  `RecordingStatusChip` and `MeetingSummarySection` omit the directive while their siblings
  declare it.

### 6. Form convention

Pick one of the three approaches currently in the codebase and apply it everywhere:

- `CreateMeetingModal` — manual `useState` per field, manual error state, raw `Label htmlFor` +
  `Input id` wiring, no `TextField` / `FieldError`, no HeroUI validation
- `login` / `register` — uncontrolled, `FormData` on submit, `validate` on `TextField`
- `DisplayNameSection` / `PasswordSection` — controlled `TextField` + `validate`

The chosen convention must cover: field-level validation, form-level API errors, field-level
API errors (`PasswordSection` maps a 400 to a field error by regex-matching the message — this
needs an explicit, non-fragile mechanism), pending state, and reset on close.

### 7. Interaction and accessibility corrections

- `MeetingRow` wraps its content in a raw `<button onClick>` and places a HeroUI `Button` as a
  sibling inside the same `<li>`. Replace with a proper link/card pattern; native `onClick` also
  contradicts the project's `onPress` rule.
- `RecordingCard` uses a HeroUI `<Link onPress>` with no `href` as a button — it should be a
  button.
- Consolidate the three ways touch targets are expressed today — `className="h-11 md:h-10"`
  (~20 occurrences), `size="lg"`, and `className="min-h-[44px] md:min-h-10"` — into one
  mechanism (a wrapped `Button` default or a `tailwind-variants` recipe), so meeting the 44px
  minimum is not a convention an author can silently forget.
- Verify heading order: `AppHeader` renders the brand as `<h1>`, and `/profile/edit` opens its
  content with `<h2>`, while other pages start at `Card.Title`.

### 8. Folder structure

- Add `src/components/ui/` for the shared primitives above.
- Resolve the cross-feature dependency: `UserAvatar` lives in `components/profile/` but is
  imported by `components/layout/AppHeader` — either it is a shared primitive or the header
  should not reach into a feature folder.
- Decide and document the placement rule for single-page section components
  (`AvatarSection`, `DisplayNameSection`, `PasswordSection` are used by exactly one page).
- One import convention: pages use `@/components/...` while meeting components import siblings
  by relative path (`./UploadRecordingModal`). Pick one and enforce it.

### 9. Page slimming

- `meetings/[id]/page.tsx` is 273 lines, of which roughly 120 are the polling and
  summary-reconciliation state machine written inline. Extract it into a dedicated hook. The
  page renders; it does not host a state machine.

### 10. Documentation

Two parts: describe the new structure, and record the rules that keep it from decaying back.

**Describe what changed:**

- Update `apps/web/CLAUDE.md` (Layout, Rules) and `docs/architecture/web.md` to describe the
  new structure — route groups, layout-owned shell and guard, the `ui/` primitive layer, the
  query layer, and where upload constants now live.
- Update `docs/testing/web.md` if the refactor changes which flows a UI change must exercise.
- Update the root `CLAUDE.md` and `README.md` for the new `@tanstack/react-query` dependency,
  since it is a new external dependency in the repo-wide sense.
- Remove statements in those files that the refactor makes false — notably the
  `apps/web/CLAUDE.md` rules pinning `ALLOWED_MIME_TYPES` / `MAX_SIZE_BYTES` to
  `RecordingUploader.tsx` and `AvatarSection.tsx`, and the description of
  `useAuthenticatedUser()` as the shared guard, once the guard lives in the layout.

**Record the rules that prevent recurrence.** Each rule below exists because this audit found
the corresponding violation; each is a rule an agent or developer could not derive from reading
the code, which is the bar `apps/web/CLAUDE.md` sets for what belongs in it:

- The app shell, header and auth guard live in a layout. A page that renders `AppHeader`, the
  background gradient, the content container or its own `!user` spinner is a bug.
- `src/components/ui/` is the only place a shared primitive lives; a component folder named
  after a feature must not be imported by another feature's component or by `layout/`.
- Upload MIME types and size caps live in `src/lib/uploads.ts` and nowhere else — this replaces
  the current rule that names the two component files as the mirror of the API allowlist.
- One form convention (whichever section 6 selects), stated explicitly, with the note that the
  other two approaches were removed on purpose.
- API errors are distinguished by status and a machine-readable field, never by matching the
  message text.
- Touch-target sizing comes from the shared mechanism, not from hand-written `h-11 md:h-10` on
  each call site.
- Data fetching goes through the query layer; a component calling `src/lib/api.ts` directly
  from a `useEffect` is a bug, alongside the existing rule that a component reaching for
  `fetch` is a bug.
- One import convention (`@/components/...` vs. relative sibling imports), stated as a rule
  rather than left to the author.

Where a rule is mechanically checkable, prefer an ESLint rule over prose, so the convention
fails at lint time rather than at review time: `no-restricted-imports` to stop feature folders
importing each other and to stop pages importing `AppHeader`, and `no-restricted-syntax` for the
raw `text-sm text-danger` string. Prose alone is a convention an author can silently forget —
which is exactly how the current duplication accumulated.

## Out of scope

- Frontend test infrastructure (Vitest, React Testing Library) and component tests — a separate
  PRD.
- Redesign work: dark-mode toggle, skeleton loaders replacing spinners, new empty-state
  illustrations, new page layouts or navigation patterns.
- Server-side auth: SSR-rendered pages, middleware route protection, or moving the JWT out of
  `localStorage`. Auth stays client-side, as documented in `apps/web/CLAUDE.md`.
- Any change to `apps/api` — no endpoints, DTOs or response shapes change.
- New user-facing features. No screen gains functionality it does not have today.
- Replacing HeroUI or Tailwind, or changing the theme tokens in `globals.css`.
- Switching `uploadMeetingRecording` off `XMLHttpRequest` — it exists for upload-progress
  events, and `apps/web/CLAUDE.md` explicitly forbids "modernising" it back to `fetch`.

## Technical constraints

- HeroUI v3 conventions hold: compound composition (`Card.Header`), `onPress` not `onClick`,
  no provider component, imports from `@heroui/react`.
- `src/app/globals.css` must keep importing `tailwindcss` before `@heroui/styles`, and must
  keep the darkened `--accent` / `--muted` overrides that bring contrast to WCAG AA.
- Touch targets stay at 44px on mobile / 40px on desktop, and text contrast stays at AA — the
  refactor must not regress either.
- `NEXT_PUBLIC_API_URL` handling, the `?token=` query-parameter form for recording and avatar
  URLs, and `UploadCancelledError` (a cancelled upload must never render as a failure) are all
  preserved.
- `RecordingCard` must keep rendering `<audio>` for `audio/mpeg` and `<video>` otherwise.
- The `UserAvatar` `key={hasAvatar ? 'image' : 'fallback'}` workaround must survive: Radix's
  Avatar never resets its loaded state, so removing the key makes a deleted avatar keep showing.
- `useAuthenticatedUser`'s `set-state-in-effect` ESLint suppression exists because
  `localStorage` is client-only; whatever replaces it must handle the same constraint without
  introducing a hydration mismatch.
- The root `<body>` already carries `suppressHydrationWarning` for browser extensions —
  keep it.
- Adding `@tanstack/react-query` is the only new runtime dependency this PRD authorizes.
- Node >= 20, pnpm 11.20.0, Prettier (`singleQuote`, `trailingComma: "all"`), and a clean
  `pnpm lint:web` + `pnpm --filter web exec tsc --noEmit`.
- The pre-commit hook runs `pnpm lint && pnpm test && pnpm test:ralph && pnpm check:links` —
  documentation links added by this work must resolve.

## Acceptance criteria

- [ ] No page file under `src/app/` renders `<AppHeader />`; the header appears exactly once,
      in a layout.
- [ ] The `bg-linear-to-br from-accent/10 via-background to-background` shell string appears in
      exactly one file.
- [ ] The `if (!user) return <Spinner/>` guard block appears in exactly one file.
- [ ] The header shows the user's avatar, name and sign-out control identically on `/`,
      `/meetings/{id}`, `/profile` and `/profile/edit` — verified in a browser, including the
      meeting page, where the avatar is missing today.
- [ ] Navigating `/` -> `/profile` -> `/` issues at most one `GET /users/me` for the session,
      verified in the network panel.
- [ ] `validateFile` and the upload MIME/size constants exist in exactly one module; grep finds
      no second copy in any component file.
- [ ] `formatFileSize`, `parseParticipants`, `EMAIL_PATTERN` and `getInitials` are all in
      `src/lib/`, and `EMAIL_PATTERN` is defined once.
- [ ] `grep -r 'text-sm text-danger' src/` returns only the `ErrorText` primitive.
- [ ] The password field with its eye toggle is written in exactly one component and used by
      login, register and all three password inputs in `PasswordSection`.
- [ ] All forms in the app use the same validation and error-display mechanism; the manual
      `titleError` / `dateError` state in `CreateMeetingModal` is gone.
- [ ] `PasswordSection` no longer identifies "current password is incorrect" by regex-matching
      the API's message string.
- [ ] Section and modal callbacks follow one naming and payload convention; `onUploaded` has one
      meaning across all components that expose it.
- [ ] The two inline confirmation modals (`RecordingCard` delete, `AvatarSection` remove) are
      replaced by one shared confirmation component.
- [ ] Touch-target sizing comes from one shared mechanism; `h-11 md:h-10` is not repeated across
      ~20 call sites.
- [ ] `MeetingRow` no longer nests a `Button` inside a `<button>`, and `RecordingCard` no longer
      uses an `href`-less `Link` as a button. Keyboard tab order through the meetings list and a
      recording card is correct.
- [ ] `meetings/[id]/page.tsx` is under 120 lines and contains no polling or
      summary-reconciliation logic.
- [ ] `'use client'` and prop ordering follow one convention across every component file.
- [ ] An `error.tsx` exists for the authenticated route group and renders a recoverable error
      state.
- [ ] `pnpm lint:web` and `pnpm --filter web exec tsc --noEmit` are clean; `pnpm build:web`
      succeeds.
- [ ] Every flow in `docs/testing/web.md` is walked with the Playwright MCP server after the
      refactor: register, login, create meeting, upload a recording (video and mp3), watch
      transcription and summary settle, delete a recording, edit display name, change password,
      upload and remove an avatar, sign out.
- [ ] The change is reviewed against the `ui-ux-pro-max` skill's guidelines, and any visual
      change introduced by the unification pass is intentional and recorded.
- [ ] `apps/web/CLAUDE.md` and `docs/architecture/web.md` describe the new structure, and no
      statement in either file describes the old one — specifically, the rules naming
      `RecordingUploader.tsx` / `AvatarSection.tsx` as the home of the upload constants and
      `useAuthenticatedUser()` as the shared guard are rewritten, not left stale.
- [ ] `apps/web/CLAUDE.md` states each preventive rule from section 10 — shell/header/guard
      belong to the layout, `ui/` is the only home for shared primitives, feature folders do not
      import each other, one form convention, one import convention, API errors are not matched
      by message text, touch-target sizing comes from the shared mechanism, and data fetching
      goes through the query layer.
- [ ] The root `CLAUDE.md` and `README.md` list `@tanstack/react-query` as a dependency of
      `apps/web`.
- [ ] At least the mechanically checkable rules are enforced by ESLint (feature-folder imports,
      pages importing `AppHeader`, the raw `text-sm text-danger` string), and `pnpm lint:web`
      fails when a violation is introduced deliberately as a check.
- [ ] `pnpm check:links` passes — every markdown link and backticked `.md` path added by this
      work resolves.
