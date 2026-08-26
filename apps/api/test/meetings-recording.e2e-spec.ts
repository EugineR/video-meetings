import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  WHISPER_RUNNER,
  WhisperRunner,
} from '../src/transcription/whisper-runner';

interface AccessTokenResponseBody {
  accessToken: string;
}

interface MeetingResponseBody {
  id: string;
}

interface RecordingResponseBody {
  id: string;
  meetingId: string;
  originalFilename: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: string;
  status: string;
  transcriptText: string | null;
}

const uploadsDir = join(tmpdir(), `video-meetings-e2e-uploads-${randomUUID()}`);

/**
 * Never resolves, so the background transcription job started by every upload in this file
 * gets stuck right after its own `PROCESSING` write and never reaches `READY`/`FAILED`. Without
 * this, a real Whisper invocation races every assertion below (and, in an environment without a
 * working local Whisper install, fails almost immediately) — exactly the flakiness the
 * `WHISPER_RUNNER` DI token exists to let tests avoid.
 */
const hangingWhisperRunner: WhisperRunner = () => new Promise(() => {});

async function registerAndLogin(
  app: INestApplication<App>,
  email: string,
): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'Password123!' })
    .expect(201);

  return (response.body as AccessTokenResponseBody).accessToken;
}

async function createMeeting(
  app: INestApplication<App>,
  token: string,
): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/meetings')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Sprint planning',
      date: '2026-09-01T10:00:00.000Z',
      participants: [],
    })
    .expect(201);

  return (response.body as MeetingResponseBody).id;
}

async function uploadRecording(
  app: INestApplication<App>,
  token: string,
  meetingId: string,
  filename: string,
  contents: Buffer | string,
  contentType = 'video/mp4',
): Promise<RecordingResponseBody> {
  const response = await request(app.getHttpServer())
    .post(`/meetings/${meetingId}/recordings`)
    .set('Authorization', `Bearer ${token}`)
    .attach('file', Buffer.from(contents), { filename, contentType })
    .expect(201);

  return response.body as RecordingResponseBody;
}

describe('Meetings Recording (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(() => {
    process.env.UPLOADS_DIR = uploadsDir;
  });

  afterAll(() => {
    rmSync(uploadsDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(WHISPER_RUNNER)
      .useValue(hangingWhisperRunner)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.meetingRecording.deleteMany();
    await prisma.meeting.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /meetings/:id/recordings', () => {
    it('uploads a recording: 201, file on disk, UPLOADED row', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      const body = await uploadRecording(
        app,
        token,
        meetingId,
        'recording.mp4',
        'fake mp4 bytes',
      );

      expect(body.meetingId).toBe(meetingId);
      expect(body.originalFilename).toBe('recording.mp4');
      expect(body.mimeType).toBe('video/mp4');
      expect(body.sizeBytes).toBe('14');
      expect(body.status).toBe('UPLOADED');
      expect(existsSync(body.storagePath)).toBe(true);

      const recording = await prisma.meetingRecording.findUnique({
        where: { id: body.id },
      });
      expect(recording).not.toBeNull();
      // Background transcription (see UploadRecordingHandler.transcribeInBackground) writes
      // PROCESSING right away, asynchronously and outside this request — by the time this
      // query runs that write may already have landed, so both are valid.
      expect(['UPLOADED', 'PROCESSING']).toContain(recording?.status);
    });

    it('uploads an mp3 recording: 201, UPLOADED row with no transcript yet', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      const body = await uploadRecording(
        app,
        token,
        meetingId,
        'recording.mp3',
        'fake mp3 bytes',
        'audio/mpeg',
      );

      expect(body.meetingId).toBe(meetingId);
      expect(body.originalFilename).toBe('recording.mp3');
      expect(body.mimeType).toBe('audio/mpeg');
      expect(body.status).toBe('UPLOADED');

      const recording = await prisma.meetingRecording.findUnique({
        where: { id: body.id },
      });
      expect(recording).not.toBeNull();
      // See the mp4 upload test above: PROCESSING may already have landed by now.
      expect(['UPLOADED', 'PROCESSING']).toContain(recording?.status);
      expect(recording?.transcriptText).toBeNull();
    });

    it('adds a second file alongside the first: two independent rows, both files on disk', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      const first = await uploadRecording(
        app,
        token,
        meetingId,
        'first.mp4',
        'first version',
      );
      const second = await uploadRecording(
        app,
        token,
        meetingId,
        'second.mp4',
        'second version, longer',
      );

      expect(second.id).not.toBe(first.id);
      expect(second.originalFilename).toBe('second.mp4');

      const rows = await prisma.meetingRecording.findMany({
        where: { meetingId },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.originalFilename)).toEqual([
        'first.mp4',
        'second.mp4',
      ]);

      const filesOnDisk = await readdir(join(uploadsDir, meetingId));
      expect(filesOnDisk).toHaveLength(2);
      expect(existsSync(first.storagePath)).toBe(true);
      expect(existsSync(second.storagePath)).toBe(true);
    });

    it('rejects an unauthenticated request (401)', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/recordings`)
        .attach('file', Buffer.from('data'), {
          filename: 'clip.mp4',
          contentType: 'video/mp4',
        })
        .expect(401);
    });

    it('rejects an upload for a meeting that does not exist (404)', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');

      await request(app.getHttpServer())
        .post('/meetings/00000000-0000-0000-0000-000000000000/recordings')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('data'), {
          filename: 'clip.mp4',
          contentType: 'video/mp4',
        })
        .expect(404);
    });

    it("rejects an upload for another user's meeting (404) and leaves no orphaned file", async () => {
      const ownerToken = await registerAndLogin(app, 'owner@example.com');
      const otherToken = await registerAndLogin(app, 'other@example.com');
      const meetingId = await createMeeting(app, ownerToken);

      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/recordings`)
        .set('Authorization', `Bearer ${otherToken}`)
        .attach('file', Buffer.from('data'), {
          filename: 'clip.mp4',
          contentType: 'video/mp4',
        })
        .expect(404);

      expect(existsSync(join(uploadsDir, meetingId))).toBe(false);
    });

    it('rejects a path-traversal meeting id (400) and writes nothing outside the uploads dir', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');

      await request(app.getHttpServer())
        .post('/meetings/..%5C..%5Ctraversal-escape/recordings')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('data'), {
          filename: 'clip.mp4',
          contentType: 'video/mp4',
        })
        .expect(400);

      expect(existsSync(join(uploadsDir, '..', 'traversal-escape'))).toBe(
        false,
      );
    });

    it('rejects a disallowed MIME type (415) and writes nothing to disk', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/recordings`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('not a video'), {
          filename: 'archive.zip',
          contentType: 'application/zip',
        })
        .expect(415);

      expect(existsSync(join(uploadsDir, meetingId))).toBe(false);
    });

    it('rejects a file exceeding the configured size limit (413) and writes nothing to disk', async () => {
      const previousMaxSize = process.env.MAX_UPLOAD_SIZE_BYTES;
      process.env.MAX_UPLOAD_SIZE_BYTES = '10';

      const smallLimitModule: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      const smallLimitApp: INestApplication<App> =
        smallLimitModule.createNestApplication();
      await smallLimitApp.init();

      try {
        const token = await registerAndLogin(
          smallLimitApp,
          'owner@example.com',
        );
        const meetingId = await createMeeting(smallLimitApp, token);

        await request(smallLimitApp.getHttpServer())
          .post(`/meetings/${meetingId}/recordings`)
          .set('Authorization', `Bearer ${token}`)
          .attach('file', Buffer.from('this buffer is longer than 10 bytes'), {
            filename: 'clip.mp4',
            contentType: 'video/mp4',
          })
          .expect(413);

        // multer's storage engine removes the partial file itself on a
        // size-limit abort (verified: node_modules/multer/lib/make-middleware.js);
        // it doesn't remove the now-empty destination directory it created,
        // so assert on file presence rather than the directory.
        const filesOnDisk = existsSync(join(uploadsDir, meetingId))
          ? await readdir(join(uploadsDir, meetingId))
          : [];
        expect(filesOnDisk).toHaveLength(0);
      } finally {
        await smallLimitApp.close();
        process.env.MAX_UPLOAD_SIZE_BYTES = previousMaxSize;
      }
    });

    it('rejects a request with no file field (400)', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/recordings`)
        .set('Authorization', `Bearer ${token}`)
        .field('note', 'no file attached here')
        .expect(400);
    });

    it('rejects a malformed multipart body (400)', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/recordings`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'multipart/form-data; boundary=broken')
        .send('not actually multipart content')
        .expect(400);
    });
  });

  describe('DELETE /meetings/:id/recordings/:recordingId', () => {
    it('deletes an existing recording (204) and removes the file from disk', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      const uploaded = await uploadRecording(
        app,
        token,
        meetingId,
        'clip.mp4',
        'data',
      );

      await request(app.getHttpServer())
        .delete(`/meetings/${meetingId}/recordings/${uploaded.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      expect(existsSync(uploaded.storagePath)).toBe(false);
      const recording = await prisma.meetingRecording.findUnique({
        where: { id: uploaded.id },
      });
      expect(recording).toBeNull();
    });

    it('deleting one recording leaves a sibling recording and its file/row fully intact', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      const first = await uploadRecording(
        app,
        token,
        meetingId,
        'first.mp4',
        'first data',
      );
      const second = await uploadRecording(
        app,
        token,
        meetingId,
        'second.mp4',
        'second data',
      );

      await request(app.getHttpServer())
        .delete(`/meetings/${meetingId}/recordings/${first.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      expect(existsSync(first.storagePath)).toBe(false);
      expect(existsSync(second.storagePath)).toBe(true);

      const remaining = await prisma.meetingRecording.findMany({
        where: { meetingId },
      });
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(second.id);

      await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/recordings/${second.id}/content`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('deleting a recording also removes its transcript, and a fresh upload starts with transcriptText null again', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      const uploaded = await uploadRecording(
        app,
        token,
        meetingId,
        'clip.mp4',
        'data',
      );

      // Simulate a finished transcription before deleting, so the assertions below prove
      // a populated transcript actually gets deleted, not just an already-null one.
      await prisma.meetingRecording.update({
        where: { id: uploaded.id },
        data: { status: 'READY', transcriptText: 'Completed transcript text' },
      });

      await request(app.getHttpServer())
        .delete(`/meetings/${meetingId}/recordings/${uploaded.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/recordings/${uploaded.id}/content`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      const deletedRow = await prisma.meetingRecording.findUnique({
        where: { id: uploaded.id },
      });
      expect(deletedRow).toBeNull();

      const fresh = await uploadRecording(
        app,
        token,
        meetingId,
        'fresh.mp4',
        'fresh data',
      );
      expect(fresh.status).toBe('UPLOADED');
      expect(fresh.transcriptText).toBeNull();
    });

    it('returns 404 when deleting again after already deleted', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      const uploaded = await uploadRecording(
        app,
        token,
        meetingId,
        'clip.mp4',
        'data',
      );

      await request(app.getHttpServer())
        .delete(`/meetings/${meetingId}/recordings/${uploaded.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      await request(app.getHttpServer())
        .delete(`/meetings/${meetingId}/recordings/${uploaded.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('returns 404 (not 500) when the recording row was already removed out-of-band', async () => {
      // Simulates the losing side of a race between two concurrent DELETE
      // requests: by the time this handler's own delete() runs, the row is
      // already gone (Prisma throws P2025), which RecordingsRepository.delete()
      // must translate into a plain "not found" rather than letting it
      // surface as an unhandled 500.
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      const uploaded = await uploadRecording(
        app,
        token,
        meetingId,
        'clip.mp4',
        'data',
      );

      await prisma.meetingRecording.delete({ where: { id: uploaded.id } });

      await request(app.getHttpServer())
        .delete(`/meetings/${meetingId}/recordings/${uploaded.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('returns 404 when the meeting has no recording', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      await request(app.getHttpServer())
        .delete(
          `/meetings/${meetingId}/recordings/00000000-0000-0000-0000-000000000000`,
        )
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('returns 404 for a meeting that does not exist', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');

      await request(app.getHttpServer())
        .delete(
          '/meetings/00000000-0000-0000-0000-000000000000/recordings/00000000-0000-0000-0000-000000000001',
        )
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it("returns 404 for another user's meeting", async () => {
      const ownerToken = await registerAndLogin(app, 'owner@example.com');
      const otherToken = await registerAndLogin(app, 'other@example.com');
      const meetingId = await createMeeting(app, ownerToken);

      const uploaded = await uploadRecording(
        app,
        ownerToken,
        meetingId,
        'clip.mp4',
        'data',
      );

      await request(app.getHttpServer())
        .delete(`/meetings/${meetingId}/recordings/${uploaded.id}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });

    it('returns 404 when the recordingId belongs to a different meeting', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingIdA = await createMeeting(app, token);
      const meetingIdB = await createMeeting(app, token);

      const uploadedInB = await uploadRecording(
        app,
        token,
        meetingIdB,
        'clip.mp4',
        'data',
      );

      await request(app.getHttpServer())
        .delete(`/meetings/${meetingIdA}/recordings/${uploadedInB.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      // Untouched: still readable via its actual meeting.
      const stillThere = await prisma.meetingRecording.findUnique({
        where: { id: uploadedInB.id },
      });
      expect(stillThere).not.toBeNull();
    });

    it('rejects an unauthenticated request (401)', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);
      const uploaded = await uploadRecording(
        app,
        token,
        meetingId,
        'clip.mp4',
        'data',
      );

      await request(app.getHttpServer())
        .delete(`/meetings/${meetingId}/recordings/${uploaded.id}`)
        .expect(401);
    });
  });

  describe('GET /meetings/:id/recordings/:recordingId/content', () => {
    it('streams bytes identical to the uploaded file, with the correct Content-Type', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);
      const fileContents = Buffer.from('the exact recorded bytes');

      const uploaded = await uploadRecording(
        app,
        token,
        meetingId,
        'clip.mp4',
        fileContents,
      );

      const response = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/recordings/${uploaded.id}/content`)
        .set('Authorization', `Bearer ${token}`)
        .responseType('blob')
        .expect(200);

      expect(response.headers['content-type']).toBe('video/mp4');
      expect(Buffer.from(response.body as Buffer).equals(fileContents)).toBe(
        true,
      );
    });

    it('streams each of two recordings independently, by its own recordingId', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);
      const firstContents = Buffer.from('first file bytes');
      const secondContents = Buffer.from('second file bytes, different');

      const first = await uploadRecording(
        app,
        token,
        meetingId,
        'first.mp4',
        firstContents,
      );
      const second = await uploadRecording(
        app,
        token,
        meetingId,
        'second.mp3',
        secondContents,
        'audio/mpeg',
      );

      const firstResponse = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/recordings/${first.id}/content`)
        .set('Authorization', `Bearer ${token}`)
        .responseType('blob')
        .expect(200);
      const secondResponse = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/recordings/${second.id}/content`)
        .set('Authorization', `Bearer ${token}`)
        .responseType('blob')
        .expect(200);

      expect(
        Buffer.from(firstResponse.body as Buffer).equals(firstContents),
      ).toBe(true);
      expect(
        Buffer.from(secondResponse.body as Buffer).equals(secondContents),
      ).toBe(true);
      expect(secondResponse.headers['content-type']).toBe('audio/mpeg');
    });

    it('authenticates via a ?token= query param (for <video> src)', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);
      const uploaded = await uploadRecording(
        app,
        token,
        meetingId,
        'clip.mp4',
        'data',
      );

      await request(app.getHttpServer())
        .get(
          `/meetings/${meetingId}/recordings/${uploaded.id}/content?token=${token}`,
        )
        .expect(200);
    });

    it('rejects a ?token= query param on a route that is not @AllowQueryToken()', async () => {
      // The query-param fallback is opt-in per route (JwtAuthGuard +
      // @AllowQueryToken()) specifically so a token leaked via a recording
      // URL can't also authenticate the rest of the API.
      const token = await registerAndLogin(app, 'owner@example.com');

      await request(app.getHttpServer())
        .get(`/meetings?token=${token}`)
        .expect(401);
    });

    it('responds 206 to a request carrying a Range header', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);
      const fileContents = Buffer.from('0123456789');

      const uploaded = await uploadRecording(
        app,
        token,
        meetingId,
        'clip.mp4',
        fileContents,
      );

      const response = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/recordings/${uploaded.id}/content`)
        .set('Authorization', `Bearer ${token}`)
        .set('Range', 'bytes=2-5')
        .responseType('blob')
        .expect(206);

      expect(response.headers['content-range']).toBe('bytes 2-5/10');
      expect(response.headers['content-length']).toBe('4');
      expect(Buffer.from(response.body as Buffer).toString()).toBe('2345');
    });

    it('returns 404 when there is no such recording', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      await request(app.getHttpServer())
        .get(
          `/meetings/${meetingId}/recordings/00000000-0000-0000-0000-000000000000/content`,
        )
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('returns 404 when the recordingId belongs to a different meeting', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingIdA = await createMeeting(app, token);
      const meetingIdB = await createMeeting(app, token);

      const uploadedInB = await uploadRecording(
        app,
        token,
        meetingIdB,
        'clip.mp4',
        'data',
      );

      await request(app.getHttpServer())
        .get(`/meetings/${meetingIdA}/recordings/${uploadedInB.id}/content`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it("returns 404 for another user's meeting", async () => {
      const ownerToken = await registerAndLogin(app, 'owner@example.com');
      const otherToken = await registerAndLogin(app, 'other@example.com');
      const meetingId = await createMeeting(app, ownerToken);

      const uploaded = await uploadRecording(
        app,
        ownerToken,
        meetingId,
        'clip.mp4',
        'data',
      );

      await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/recordings/${uploaded.id}/content`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });

    it('rejects an unauthenticated request (401)', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);
      const uploaded = await uploadRecording(
        app,
        token,
        meetingId,
        'clip.mp4',
        'data',
      );

      await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/recordings/${uploaded.id}/content`)
        .expect(401);
    });
  });

  describe('recordings field on the meeting read endpoints', () => {
    it('GET /meetings/:id returns recordings: [] without any recording, then each file after upload', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      const beforeResponse = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(
        (beforeResponse.body as { recordings: unknown[] }).recordings,
      ).toEqual([]);

      const first = await uploadRecording(
        app,
        token,
        meetingId,
        'first.mp4',
        'first data',
      );
      const second = await uploadRecording(
        app,
        token,
        meetingId,
        'second.mp4',
        'second data, longer',
      );

      const afterResponse = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const recordings = (
        afterResponse.body as { recordings: RecordingResponseBody[] }
      ).recordings;
      expect(recordings).toHaveLength(2);
      expect(recordings.map((r) => r.id).sort()).toEqual(
        [first.id, second.id].sort(),
      );
      const firstFromResponse = recordings.find((r) => r.id === first.id);
      expect(firstFromResponse?.originalFilename).toBe('first.mp4');
      expect(firstFromResponse?.sizeBytes).toBe('10');
    });

    it('exposes status and transcriptText on each recording, transcriptText null right after upload', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      const uploaded = await uploadRecording(
        app,
        token,
        meetingId,
        'clip.mp4',
        'data',
      );
      expect(uploaded.status).toBe('UPLOADED');
      expect(uploaded.transcriptText).toBeNull();

      const detailResponse = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const recordings = (
        detailResponse.body as { recordings: RecordingResponseBody[] }
      ).recordings;
      expect(recordings).toHaveLength(1);
      expect(['UPLOADED', 'PROCESSING']).toContain(recordings[0].status);
      expect(recordings[0].transcriptText).toBeNull();
    });

    it('GET /meetings returns recordingCount matching the number of files uploaded to each meeting', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const withTwoId = await createMeeting(app, token);
      const withOneId = await createMeeting(app, token);
      const withNoneId = await createMeeting(app, token);

      await uploadRecording(app, token, withTwoId, 'a.mp4', 'a');
      await uploadRecording(app, token, withTwoId, 'b.mp4', 'b');
      await uploadRecording(app, token, withOneId, 'c.mp4', 'c');

      const response = await request(app.getHttpServer())
        .get('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body as Array<{
        id: string;
        recordingCount: number;
      }>;
      expect(body.find((m) => m.id === withTwoId)?.recordingCount).toBe(2);
      expect(body.find((m) => m.id === withOneId)?.recordingCount).toBe(1);
      expect(body.find((m) => m.id === withNoneId)?.recordingCount).toBe(0);
    });
  });

  describe('cascade delete', () => {
    it('deletes every meeting_recordings row when the meeting is deleted', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      await uploadRecording(app, token, meetingId, 'a.mp4', 'a');
      await uploadRecording(app, token, meetingId, 'b.mp4', 'b');

      await prisma.meeting.delete({ where: { id: meetingId } });

      const recordings = await prisma.meetingRecording.findMany({
        where: { meetingId },
      });
      expect(recordings).toHaveLength(0);
    });

    it('deletes the meeting_recordings row when the owning user is deleted', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      await uploadRecording(app, token, meetingId, 'clip.mp4', 'data');

      const meeting = await prisma.meeting.findUniqueOrThrow({
        where: { id: meetingId },
      });
      await prisma.user.delete({ where: { id: meeting.ownerId } });

      const recordings = await prisma.meetingRecording.findMany({
        where: { meetingId },
      });
      expect(recordings).toHaveLength(0);
    });
  });
});
