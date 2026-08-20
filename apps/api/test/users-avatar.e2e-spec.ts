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

interface ProfileResponseBody {
  id: string;
  hasAvatar: boolean;
  avatarUpdatedAt: string | null;
}

interface AvatarResponseBody {
  id: string;
  userId: string;
  originalFilename: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: string;
}

const uploadsDir = join(tmpdir(), `video-meetings-e2e-avatars-${randomUUID()}`);

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

async function getUserId(
  app: INestApplication<App>,
  token: string,
): Promise<string> {
  const response = await request(app.getHttpServer())
    .get('/users/me')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  return (response.body as ProfileResponseBody).id;
}

async function getProfile(
  app: INestApplication<App>,
  token: string,
): Promise<ProfileResponseBody> {
  const response = await request(app.getHttpServer())
    .get('/users/me')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  return response.body as ProfileResponseBody;
}

describe('Users Avatar (e2e)', () => {
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
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /users/me/avatar', () => {
    it.each([
      ['image/png', 'avatar.png'],
      ['image/jpeg', 'avatar.jpg'],
      ['image/webp', 'avatar.webp'],
    ])(
      'uploads a %s avatar: 201 with metadata and a file under {UPLOADS_DIR}/avatars/{userId}/',
      async (contentType, filename) => {
        const token = await registerAndLogin(app, 'owner@example.com');
        const userId = await getUserId(app, token);

        const response = await request(app.getHttpServer())
          .post('/users/me/avatar')
          .set('Authorization', `Bearer ${token}`)
          .attach('file', Buffer.from('fake image bytes'), {
            filename,
            contentType,
          })
          .expect(201);

        const body = response.body as AvatarResponseBody;
        expect(body.userId).toBe(userId);
        expect(body.originalFilename).toBe(filename);
        expect(body.mimeType).toBe(contentType);
        expect(body.sizeBytes).toBe('16');
        expect(existsSync(body.storagePath)).toBe(true);
        expect(body.storagePath).toContain(join('avatars', userId));
      },
    );

    it('replaces an existing avatar: only the new file on disk', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const userId = await getUserId(app, token);

      const firstResponse = await request(app.getHttpServer())
        .post('/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('first version'), {
          filename: 'first.png',
          contentType: 'image/png',
        })
        .expect(201);
      const first = firstResponse.body as AvatarResponseBody;

      const secondResponse = await request(app.getHttpServer())
        .post('/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('second version, longer'), {
          filename: 'second.png',
          contentType: 'image/png',
        })
        .expect(201);
      const second = secondResponse.body as AvatarResponseBody;

      expect(second.originalFilename).toBe('second.png');
      expect(existsSync(first.storagePath)).toBe(false);
      expect(existsSync(second.storagePath)).toBe(true);

      const filesOnDisk = await readdir(join(uploadsDir, 'avatars', userId));
      expect(filesOnDisk).toHaveLength(1);
    });

    it('rejects a .txt file (415) and writes nothing to disk', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const userId = await getUserId(app, token);

      await request(app.getHttpServer())
        .post('/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('not an image'), {
          filename: 'notes.txt',
          contentType: 'text/plain',
        })
        .expect(415);

      expect(existsSync(join(uploadsDir, 'avatars', userId))).toBe(false);
    });

    it('rejects a .png file sent with a disallowed MIME type (415) and writes nothing to disk', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const userId = await getUserId(app, token);

      await request(app.getHttpServer())
        .post('/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('not really an image'), {
          filename: 'avatar.png',
          contentType: 'application/octet-stream',
        })
        .expect(415);

      expect(existsSync(join(uploadsDir, 'avatars', userId))).toBe(false);
    });

    it('rejects a file exceeding MAX_AVATAR_SIZE_BYTES (413) and writes nothing to disk', async () => {
      const previousMaxSize = process.env.MAX_AVATAR_SIZE_BYTES;
      process.env.MAX_AVATAR_SIZE_BYTES = '10';

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
        const userId = await getUserId(smallLimitApp, token);

        await request(smallLimitApp.getHttpServer())
          .post('/users/me/avatar')
          .set('Authorization', `Bearer ${token}`)
          .attach('file', Buffer.from('this buffer is longer than 10 bytes'), {
            filename: 'avatar.png',
            contentType: 'image/png',
          })
          .expect(413);

        const filesOnDisk = existsSync(join(uploadsDir, 'avatars', userId))
          ? await readdir(join(uploadsDir, 'avatars', userId))
          : [];
        expect(filesOnDisk).toHaveLength(0);
      } finally {
        await smallLimitApp.close();
        if (previousMaxSize === undefined) {
          delete process.env.MAX_AVATAR_SIZE_BYTES;
        } else {
          process.env.MAX_AVATAR_SIZE_BYTES = previousMaxSize;
        }
      }
    });

    it('rejects an unauthenticated request (401)', async () => {
      await request(app.getHttpServer())
        .post('/users/me/avatar')
        .attach('file', Buffer.from('data'), {
          filename: 'avatar.png',
          contentType: 'image/png',
        })
        .expect(401);
    });
  });

  describe('DELETE /users/me/avatar', () => {
    it('deletes an existing avatar (204) and removes the file from disk', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');

      const uploadResponse = await request(app.getHttpServer())
        .post('/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('data'), {
          filename: 'avatar.png',
          contentType: 'image/png',
        })
        .expect(201);
      const { storagePath } = uploadResponse.body as AvatarResponseBody;

      await request(app.getHttpServer())
        .delete('/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      expect(existsSync(storagePath)).toBe(false);
    });

    it('returns 404 when deleting again after already deleted', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');

      await request(app.getHttpServer())
        .post('/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('data'), {
          filename: 'avatar.png',
          contentType: 'image/png',
        })
        .expect(201);

      await request(app.getHttpServer())
        .delete('/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      await request(app.getHttpServer())
        .delete('/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('returns 404 when the user has no avatar', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');

      await request(app.getHttpServer())
        .delete('/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('rejects an unauthenticated request (401)', async () => {
      await request(app.getHttpServer()).delete('/users/me/avatar').expect(401);
    });
  });

  describe('GET /users/me/avatar', () => {
    it('streams the exact uploaded bytes with the matching Content-Type', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const fileContents = Buffer.from('the exact avatar bytes');

      await request(app.getHttpServer())
        .post('/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', fileContents, {
          filename: 'avatar.png',
          contentType: 'image/png',
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get('/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .responseType('blob')
        .expect(200);

      expect(response.headers['content-type']).toBe('image/png');
      expect(Buffer.from(response.body as Buffer).equals(fileContents)).toBe(
        true,
      );
    });

    it('authenticates via a ?token= query param (for <img> src)', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');

      await request(app.getHttpServer())
        .post('/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('data'), {
          filename: 'avatar.png',
          contentType: 'image/png',
        })
        .expect(201);

      await request(app.getHttpServer())
        .get(`/users/me/avatar?token=${token}`)
        .expect(200);
    });

    it('returns 404 when there is no avatar', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');

      await request(app.getHttpServer())
        .get('/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('rejects an unauthenticated request (401)', async () => {
      await request(app.getHttpServer()).get('/users/me/avatar').expect(401);
    });
  });

  describe('hasAvatar / avatarUpdatedAt on GET /users/me', () => {
    it('reports no avatar before upload, then true with a timestamp after upload, then false again after delete', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');

      const beforeUpload = await getProfile(app, token);
      expect(beforeUpload.hasAvatar).toBe(false);
      expect(beforeUpload.avatarUpdatedAt).toBeNull();

      await request(app.getHttpServer())
        .post('/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('data'), {
          filename: 'avatar.png',
          contentType: 'image/png',
        })
        .expect(201);

      const afterUpload = await getProfile(app, token);
      expect(afterUpload.hasAvatar).toBe(true);
      expect(afterUpload.avatarUpdatedAt).toEqual(expect.any(String));

      await request(app.getHttpServer())
        .delete('/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      const afterDelete = await getProfile(app, token);
      expect(afterDelete.hasAvatar).toBe(false);
      expect(afterDelete.avatarUpdatedAt).toBeNull();
    });
  });

  describe('cascade delete', () => {
    it('deletes the user_avatars row when the owning user is deleted', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');
      const userId = await getUserId(app, token);

      await request(app.getHttpServer())
        .post('/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('data'), {
          filename: 'avatar.png',
          contentType: 'image/png',
        })
        .expect(201);

      await prisma.user.delete({ where: { id: userId } });

      const avatar = await prisma.userAvatar.findUnique({
        where: { userId },
      });
      expect(avatar).toBeNull();
    });
  });
});
