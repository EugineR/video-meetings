# Research: Meeting Recording File Upload — Technical Implementation

**Plan:** docs/plan-meeting-recording-upload.md
**PRD:** docs/prd-meeting-recording-upload.md
**Date:** 2026-08-17

This document resolves the technical "how" behind the plan's phases — concrete library APIs, verified against the versions actually installed in this repo (not just docs), plus the design decisions the PRD/plan deliberately left open.

## Environment actually installed (verified)

- `@nestjs/platform-express@11.1.29`, pulling in **`multer@2.2.0`** transitively (`pnpm why multer`) — not yet a direct dependency, must be added explicitly (see [Dependencies to add](#dependencies-to-add)).
- `express@5.2.1` — multer 2.x targets Express 4/5 and Node's stream APIs; no compatibility issue found.
- No `@types/multer` installed — needed for `Express.Multer.File` typings.
- Nest 11's Prisma setup already uses `@prisma/adapter-pg` (Prisma 7), consistent with the plan's `BigInt` field.

## 1. Upload ingestion: `FileInterceptor` + `diskStorage`

Use `@nestjs/platform-express`'s `FileInterceptor('file', { storage: diskStorage(...), limits, fileFilter })` exactly as the plan specifies — not a raw `busboy` stream and not `memoryStorage`. Two verified findings change what the handler needs to do manually:

### 1a. Nest already maps most multer errors to the right HTTP status — don't write a `MulterExceptionFilter`

Generic tutorials (and multer's own issue tracker) suggest writing a custom `@Catch(MulterError)` filter to turn `LIMIT_FILE_SIZE` into 413. **That's unnecessary here.** Read directly from the installed package (`node_modules/@nestjs/platform-express/multer/multer/multer.utils.js`, `transformException`):

```js
switch (error.message) {
  case multerExceptions.LIMIT_FILE_SIZE:
    return new PayloadTooLargeException(error.message);   // 413
  case multerExceptions.LIMIT_FILE_COUNT:
  case multerExceptions.LIMIT_FIELD_KEY:
  // ...
  case multerExceptions.MISSING_FIELD_NAME:
    return new BadRequestException(...);                   // 400
  case busboyExceptions.MULTIPART_BOUNDARY_NOT_FOUND:
  case busboyExceptions.MULTIPART_MALFORMED_PART_HEADER:
    return new BadRequestException(...);                   // 400
}
```

And critically: **`if (!error || error instanceof HttpException) return error;`** — if `fileFilter`'s callback is invoked with a Nest `HttpException`, Nest passes it straight through untouched.

Implication for `UploadRecordingCommand`'s handler / interceptor config:

- Size limit (413) — handled automatically by `limits: { fileSize: MAX_UPLOAD_SIZE_BYTES }`. No extra code.
- Malformed multipart body (400) — handled automatically. No extra code.
- MIME/extension allowlist (415) — do it inside `fileFilter`, and reject with a real Nest exception so it passes through unmodified:
  ```ts
  fileFilter: (req, file, cb) => {
    if (!isAllowed(file.mimetype, file.originalname)) {
      return cb(new UnsupportedMediaTypeException('...'), false);
    }
    cb(null, true);
  };
  ```
- Missing `file` field (400) — multer does **not** error when the field is simply absent (`fileFilter` is never invoked, `req.file` stays `undefined`); the handler must explicitly check `if (!file) throw new BadRequestException(...)` after the interceptor runs. This is the one case Nest can't infer for you.

### 1b. Multer 2.x's storage engine auto-removes partial/rejected files — don't write manual `fs.unlink` cleanup

Read directly from the installed package (`node_modules/multer/lib/make-middleware.js`): both a `fileFilter` rejection (`cb(err, false)`) and a size-limit abort (the `fileStream.on('limit', ...)` handler) route through the same `abortWithError` → `removeUploadedFiles` → `storage._removeFile` path _before_ multer's middleware callback fires. In other words, `diskStorage` already guarantees "no partially written file on disk" and "no file written to disk" for the 413/415 acceptance criteria — multer removes it itself, synchronously as part of erroring out. Older multer 1.x had known bugs here (`expressjs/multer#746`); 2.2.0's storage-engine rewrite fixed this. **Still worth one explicit e2e assertion** (list the upload dir after a rejected upload) rather than trusting this blindly, since it's inferred from reading the library rather than from multer's own docs.

### 1c. `diskStorage` destination/filename scheme

```ts
diskStorage({
  destination: (req, file, cb) => {
    const dir = join(uploadsDir, req.params.id); // Nest has already matched :id before the interceptor runs
    fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
  },
  filename: (req, file, cb) => {
    cb(null, `${randomUUID()}${extname(file.originalname)}`);
  },
});
```

`req.params.id` is reliably populated at this point — Nest's Express adapter matches the route (and its params) before invoking the bound interceptor, which is the standard pattern (mirrored in the well-known wanago.io NestJS video-streaming series). Derive the extension from `originalname` (already validated against the allowlist in `fileFilter`) rather than from `mimetype`, since MIME→extension mapping is lossier.

## 2. `StorageService`

Single local-filesystem implementation per the plan. Keep the interface small and swappable (the PRD explicitly calls this out as the seam for a future S3 move):

```ts
interface StorageService {
  save(
    meetingId: string,
    file: Express.Multer.File,
  ): Promise<{ storagePath: string }>;
  createReadStream(
    storagePath: string,
    range?: { start: number; end: number },
  ): fs.ReadStream;
  getSize(storagePath: string): Promise<number>;
  delete(storagePath: string): Promise<void>;
  exists(storagePath: string): Promise<boolean>;
}
```

Since `diskStorage` already writes the file before the handler runs, `save()` mostly just records/returns the path multer already produced (or, if you want `StorageService` to own the write path end-to-end, have it _supply_ the `diskStorage` config rather than wrapping a post-hoc copy — cheaper and avoids double I/O). `createReadStream` must accept an optional byte range for HTTP Range support (see below) — `fs.createReadStream(path, { start, end })`.

## 3. Serving content: `GET /meetings/:id/recording/content` with Range support

`StreamableFile` (Nest's built-in helper) is designed for whole-file downloads with `Content-Disposition`; it does not compute `206`/`Content-Range` for you. Since the Range branch needs a custom status code and header set regardless, **don't mix `StreamableFile` for the no-Range case and manual streaming for the Range case** — use one manual code path via `@Res({ passthrough: false })` for both:

```ts
@Get(':id/recording/content')
async streamRecording(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
  const recording = await this.queryBus.execute(new GetRecordingQuery(id, ...));
  const total = await this.storage.getSize(recording.storagePath);
  const range = parseRange(req.headers.range, total); // undefined | { start, end }

  res.status(range ? 206 : 200);
  res.setHeader('Content-Type', recording.mimeType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Length', range ? range.end - range.start + 1 : total);
  if (range) res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${total}`);

  this.storage.createReadStream(recording.storagePath, range).pipe(res);
}
```

Note the Nest gotcha this implies: with `@Res()` (non-passthrough), Nest's automatic response handling is disabled for this route — thrown exceptions (e.g. `NotFoundException` for a missing recording) still work fine as long as they're thrown _before_ anything touches `res`, but nothing you `return` from the method gets serialized afterward.

## 4. Authenticating the `<video>` element

The PRD flags this as an open implementation choice (no `Authorization` header on `<video src>`) and explicitly rules out nothing except "must not become public." Two realistic options, evaluated against this codebase specifically:

| Option                                                            | Fit here                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cookie-based session                                              | Would require introducing a second auth mechanism alongside the existing `localStorage`-JWT scheme (`apps/web/src/lib/auth.ts`) — the app has zero cookie handling today, and `src/main.ts`'s CORS config would need `credentials: true` plus `SameSite` tuning. More moving parts than the feature needs. |
| **Short-lived signed token in the URL query param** (recommended) | Reuses the existing `TokenService`/`JwtService` already in `AuthModule` (`apps/api/src/auth/token.service.ts`) — one more narrowly-scoped `sign()` call, no new auth mechanism.                                                                                                                            |

Recommended shape: mint a token distinct from the main access token — short expiry (e.g. 60–300s, long enough to open the player, short enough that it landing in browser history/server access logs isn't a standing credential) and scoped narrowly (`{ purpose: 'recording-content', meetingId }`, verified by a small guard on the content route that accepts either the normal `Authorization` header _or_ a valid `?token=`). Mint it as part of the same authenticated response that already returns the recording metadata (`GetMeetingByIdQuery`/`GetRecordingQuery`), so `getRecordingContentUrl` in `src/lib/api.ts` can build the `<video src>` URL from data already in hand rather than issuing a second round trip before every play.

## 5. `BigInt` → JSON boundary

`sizeBytes` as a Prisma `BigInt` throws on default `JSON.stringify` (used implicitly by Express's `res.json()`). This codebase's convention (per `apps/api/CLAUDE.md`) is "handlers return the Prisma model directly, no response DTO layer" — stay consistent with that rather than introducing a serialization layer or a global `BigInt.prototype.toJSON` monkey-patch (the latter is a common quick fix online, but a global mutable-prototype change is a bigger footprint than this needs and could surprise unrelated code). Convert at the return boundary in the query/command handler instead: `{ ...recording, sizeBytes: recording.sizeBytes.toString() }`.

## 6. Frontend upload (`apps/web`)

- **XHR over `fetch` is correct and unavoidable** — confirmed still true: `fetch`'s request-body streaming (needed for upload progress) has no `progress` event equivalent, and the alternative (a `ReadableStream` request body with manual chunking) has inconsistent cross-browser support and doesn't solve progress reporting for `multipart/form-data` from a plain `<input type="file">` anyway. The plan/PRD's choice to isolate this one function (`uploadMeetingRecording`) as the sole `XMLHttpRequest` user in `api.ts`, while every other call keeps the `fetch` wrapper, is the right scope — don't generalize it into a second HTTP client abstraction.
- Cancel: `xhr.abort()`, wired to the component's "Cancel" button; wrap in a small object/return value (`{ promise, cancel }`) from `uploadMeetingRecording` rather than a bare `Promise`, since the caller needs a handle to abort mid-flight.
- Client-side type/size validation needs the same allowlist/limit the server enforces (`ALLOWED_RECORDING_MIME_TYPES`, `MAX_UPLOAD_SIZE_BYTES`), but those are server-only env vars today. Simplest option that avoids a second network round-trip just to fetch config: mirror them as `NEXT_PUBLIC_*` vars in `apps/web/.env.example`. This is still manual duplication (no shared config mechanism exists between the two apps in this monorepo) — acceptable for a static allowlist, but worth a one-line note in both `.env.example` files pointing at each other so a future change to one doesn't silently drift from the other.

## 7. Testing implications

- `supertest`'s `.attach('file', buffer, filename)` (or a fixture file under `test/fixtures/`) drives the multipart upload in `test/meetings-recording.e2e-spec.ts`.
- Checksum assertions: `crypto.createHash('sha256').update(buffer).digest('hex')` compared between the uploaded fixture and the bytes returned by `GET .../content`.
- Unlike the existing e2e specs (which only need to truncate Postgres tables in `beforeEach`), these tests also write real files under `UPLOADS_DIR` — clean up the per-test `UPLOADS_DIR/{meetingId}` directory in `afterEach`/`afterAll`, or point `UPLOADS_DIR` at a dedicated test-scratch directory that's wiped wholesale, so repeated runs don't accumulate files or leak state across the `maxWorkers: 1` serial suite.
- Range-request assertions (206 case) need a fixture large enough to make a partial-range request meaningful (a few KB is enough — no need for a real video file).

## Dependencies to add

- `apps/api/package.json` dependencies: `multer` (pin to the `^2.x` line already resolved transitively — making it explicit rather than relying on `@nestjs/platform-express`'s transitive resolution, since the plan's `StorageService`/`diskStorage` config imports from `multer` directly).
- `apps/api/package.json` devDependencies: `@types/multer`.
- No new dependency needed for Range parsing — a `parseRange`-equivalent is ~15 lines against the `Range: bytes=start-end` grammar; pulling in the `range-parser` package (Express's own internal dependency, already on disk transitively) is a reasonable alternative to hand-rolling it if edge cases (multi-range, suffix ranges `-500`) matter, but the PRD only requires single-range seeking support.

## Open decisions this research resolves (for the plan's implementer)

1. **No custom Multer exception filter** — Nest's built-in `transformException` already covers 413/400; only the 415 (`fileFilter`) and the "missing file field" 400 need explicit handler code.
2. **No manual partial-file cleanup code** — multer 2.x's storage engine already removes rejected/oversized files as part of aborting.
3. **Range streaming bypasses `StreamableFile`** — use `@Res({ passthrough: false })` uniformly for the content route.
4. **Video auth = short-lived signed query token**, minted via the existing `TokenService`, delivered alongside the recording metadata response — not a cookie.
5. **`BigInt` serialized manually at the handler boundary**, consistent with the existing "no DTO layer" convention — not a global prototype patch.
