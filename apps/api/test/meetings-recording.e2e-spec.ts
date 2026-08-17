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
});
