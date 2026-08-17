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
}

const uploadsDir = join(tmpdir(), `video-meetings-e2e-uploads-${randomUUID()}`);

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
    }).compile();

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

  describe('POST /meetings/:id/recording', () => {
    it('uploads a recording: 201, file on disk, UPLOADED row', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      const response = await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/recording`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('fake mp4 bytes'), {
          filename: 'recording.mp4',
          contentType: 'video/mp4',
        })
        .expect(201);

      const body = response.body as RecordingResponseBody;
      expect(body.meetingId).toBe(meetingId);
      expect(body.originalFilename).toBe('recording.mp4');
      expect(body.mimeType).toBe('video/mp4');
      expect(body.sizeBytes).toBe('14');
      expect(body.status).toBe('UPLOADED');
      expect(existsSync(body.storagePath)).toBe(true);

      const recording = await prisma.meetingRecording.findUnique({
        where: { meetingId },
      });
      expect(recording).not.toBeNull();
      expect(recording?.status).toBe('UPLOADED');
    });

    it('replaces an existing recording: single row, only the new file on disk', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/recording`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('first version'), {
          filename: 'first.mp4',
          contentType: 'video/mp4',
        })
        .expect(201);

      const secondResponse = await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/recording`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('second version, longer'), {
          filename: 'second.mp4',
          contentType: 'video/mp4',
        })
        .expect(201);

      const second = secondResponse.body as RecordingResponseBody;
      expect(second.originalFilename).toBe('second.mp4');

      const rows = await prisma.meetingRecording.findMany({
        where: { meetingId },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].originalFilename).toBe('second.mp4');

      const filesOnDisk = await readdir(join(uploadsDir, meetingId));
      expect(filesOnDisk).toHaveLength(1);
    });

    it('rejects an unauthenticated request (401)', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/recording`)
        .attach('file', Buffer.from('data'), {
          filename: 'clip.mp4',
          contentType: 'video/mp4',
        })
        .expect(401);
    });

    it('rejects an upload for a meeting that does not exist (404)', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');

      await request(app.getHttpServer())
        .post('/meetings/00000000-0000-0000-0000-000000000000/recording')
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
        .post(`/meetings/${meetingId}/recording`)
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
        .post('/meetings/..%5C..%5Ctraversal-escape/recording')
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
        .post(`/meetings/${meetingId}/recording`)
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
          .post(`/meetings/${meetingId}/recording`)
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
        .post(`/meetings/${meetingId}/recording`)
        .set('Authorization', `Bearer ${token}`)
        .field('note', 'no file attached here')
        .expect(400);
    });

    it('rejects a malformed multipart body (400)', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/recording`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'multipart/form-data; boundary=broken')
        .send('not actually multipart content')
        .expect(400);
    });
  });

  describe('DELETE /meetings/:id/recording', () => {
    it('deletes an existing recording (204) and removes the file from disk', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      const uploadResponse = await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/recording`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('data'), {
          filename: 'clip.mp4',
          contentType: 'video/mp4',
        })
        .expect(201);
      const { storagePath } = uploadResponse.body as RecordingResponseBody;

      await request(app.getHttpServer())
        .delete(`/meetings/${meetingId}/recording`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      expect(existsSync(storagePath)).toBe(false);
      const recording = await prisma.meetingRecording.findUnique({
        where: { meetingId },
      });
      expect(recording).toBeNull();
    });

    it('returns 404 when deleting again after already deleted', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/recording`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('data'), {
          filename: 'clip.mp4',
          contentType: 'video/mp4',
        })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/meetings/${meetingId}/recording`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      await request(app.getHttpServer())
        .delete(`/meetings/${meetingId}/recording`)
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

      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/recording`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('data'), {
          filename: 'clip.mp4',
          contentType: 'video/mp4',
        })
        .expect(201);

      await prisma.meetingRecording.delete({ where: { meetingId } });

      await request(app.getHttpServer())
        .delete(`/meetings/${meetingId}/recording`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('returns 404 when the meeting has no recording', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      await request(app.getHttpServer())
        .delete(`/meetings/${meetingId}/recording`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('returns 404 for a meeting that does not exist', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');

      await request(app.getHttpServer())
        .delete('/meetings/00000000-0000-0000-0000-000000000000/recording')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it("returns 404 for another user's meeting", async () => {
      const ownerToken = await registerAndLogin(app, 'owner@example.com');
      const otherToken = await registerAndLogin(app, 'other@example.com');
      const meetingId = await createMeeting(app, ownerToken);

      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/recording`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .attach('file', Buffer.from('data'), {
          filename: 'clip.mp4',
          contentType: 'video/mp4',
        })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/meetings/${meetingId}/recording`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });

    it('rejects an unauthenticated request (401)', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      await request(app.getHttpServer())
        .delete(`/meetings/${meetingId}/recording`)
        .expect(401);
    });
  });

  describe('GET /meetings/:id/recording/content', () => {
    it('streams bytes identical to the uploaded file, with the correct Content-Type', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);
      const fileContents = Buffer.from('the exact recorded bytes');

      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/recording`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', fileContents, {
          filename: 'clip.mp4',
          contentType: 'video/mp4',
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/recording/content`)
        .set('Authorization', `Bearer ${token}`)
        .responseType('blob')
        .expect(200);

      expect(response.headers['content-type']).toBe('video/mp4');
      expect(Buffer.from(response.body as Buffer).equals(fileContents)).toBe(
        true,
      );
    });

    it('authenticates via a ?token= query param (for <video> src)', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/recording`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('data'), {
          filename: 'clip.mp4',
          contentType: 'video/mp4',
        })
        .expect(201);

      await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/recording/content?token=${token}`)
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

      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/recording`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', fileContents, {
          filename: 'clip.mp4',
          contentType: 'video/mp4',
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/recording/content`)
        .set('Authorization', `Bearer ${token}`)
        .set('Range', 'bytes=2-5')
        .responseType('blob')
        .expect(206);

      expect(response.headers['content-range']).toBe('bytes 2-5/10');
      expect(response.headers['content-length']).toBe('4');
      expect(Buffer.from(response.body as Buffer).toString()).toBe('2345');
    });

    it('returns 404 when there is no recording', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/recording/content`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it("returns 404 for another user's meeting", async () => {
      const ownerToken = await registerAndLogin(app, 'owner@example.com');
      const otherToken = await registerAndLogin(app, 'other@example.com');
      const meetingId = await createMeeting(app, ownerToken);

      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/recording`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .attach('file', Buffer.from('data'), {
          filename: 'clip.mp4',
          contentType: 'video/mp4',
        })
        .expect(201);

      await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/recording/content`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });

    it('rejects an unauthenticated request (401)', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/recording/content`)
        .expect(401);
    });
  });

  describe('recording fields on the meeting read endpoints', () => {
    it('GET /meetings/:id returns recording: null without a recording, then the metadata after upload', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      const beforeResponse = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect((beforeResponse.body as { recording: unknown }).recording).toBe(
        null,
      );

      const uploadResponse = await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/recording`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('data'), {
          filename: 'clip.mp4',
          contentType: 'video/mp4',
        })
        .expect(201);
      const uploaded = uploadResponse.body as RecordingResponseBody;

      const afterResponse = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const recording = (
        afterResponse.body as { recording: RecordingResponseBody }
      ).recording;
      expect(recording.id).toBe(uploaded.id);
      expect(recording.originalFilename).toBe('clip.mp4');
      expect(recording.sizeBytes).toBe('4');
    });

    it('GET /meetings returns hasRecording: true only for meetings with a recording', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const withRecordingId = await createMeeting(app, token);
      const withoutRecordingId = await createMeeting(app, token);

      await request(app.getHttpServer())
        .post(`/meetings/${withRecordingId}/recording`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('data'), {
          filename: 'clip.mp4',
          contentType: 'video/mp4',
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body as Array<{
        id: string;
        hasRecording: boolean;
      }>;
      expect(body.find((m) => m.id === withRecordingId)?.hasRecording).toBe(
        true,
      );
      expect(body.find((m) => m.id === withoutRecordingId)?.hasRecording).toBe(
        false,
      );
    });
  });

  describe('cascade delete', () => {
    it('deletes the meeting_recordings row when the meeting is deleted', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/recording`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('data'), {
          filename: 'clip.mp4',
          contentType: 'video/mp4',
        })
        .expect(201);

      await prisma.meeting.delete({ where: { id: meetingId } });

      const recording = await prisma.meetingRecording.findUnique({
        where: { meetingId },
      });
      expect(recording).toBeNull();
    });

    it('deletes the meeting_recordings row when the owning user is deleted', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const meetingId = await createMeeting(app, token);

      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/recording`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('data'), {
          filename: 'clip.mp4',
          contentType: 'video/mp4',
        })
        .expect(201);

      const meeting = await prisma.meeting.findUniqueOrThrow({
        where: { id: meetingId },
      });
      await prisma.user.delete({ where: { id: meeting.ownerId } });

      const recording = await prisma.meetingRecording.findUnique({
        where: { meetingId },
      });
      expect(recording).toBeNull();
    });
  });
});
