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
  email: string;
  name: string | null;
  createdAt: string;
}

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

describe('Users profile (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

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

  describe('/users/me (GET)', () => {
    it("returns the authenticated user's profile", async () => {
      const token = await registerAndLogin(app, 'owner@example.com');

      const response = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body as ProfileResponseBody;
      expect(body.id).toEqual(expect.any(String));
      expect(body.email).toBe('owner@example.com');
      expect(body.name).toBeNull();
      expect(body.createdAt).toEqual(expect.any(String));
    });

    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/users/me').expect(401);
    });

    it("never returns another user's profile", async () => {
      const ownerToken = await registerAndLogin(app, 'owner@example.com');
      await registerAndLogin(app, 'other@example.com');

      const response = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const body = response.body as ProfileResponseBody;
      expect(body.email).toBe('owner@example.com');
    });
  });

  describe('/users/me (PATCH)', () => {
    it('updates the display name and reflects it on a follow-up GET', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');

      const patchResponse = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Jane Doe' })
        .expect(200);

      expect((patchResponse.body as ProfileResponseBody).name).toBe('Jane Doe');

      const getResponse = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect((getResponse.body as ProfileResponseBody).name).toBe('Jane Doe');
    });

    it('stores a blank name as null', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');

      const patchResponse = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '   ' })
        .expect(200);

      expect((patchResponse.body as ProfileResponseBody).name).toBeNull();

      const getResponse = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect((getResponse.body as ProfileResponseBody).name).toBeNull();
    });

    it('clears the stored name when name is explicitly null', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');

      await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Jane Doe' })
        .expect(200);

      const patchResponse = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: null })
        .expect(200);

      expect((patchResponse.body as ProfileResponseBody).name).toBeNull();

      const getResponse = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect((getResponse.body as ProfileResponseBody).name).toBeNull();
    });

    it('leaves the stored name untouched when name is omitted', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');

      await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Jane Doe' })
        .expect(200);

      const patchResponse = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(200);

      expect((patchResponse.body as ProfileResponseBody).name).toBe('Jane Doe');

      const getResponse = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect((getResponse.body as ProfileResponseBody).name).toBe('Jane Doe');
    });

    it('rejects a name over 100 characters and leaves the stored name unchanged', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');

      await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Jane Doe' })
        .expect(200);

      await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'A'.repeat(101) })
        .expect(400);

      const getResponse = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect((getResponse.body as ProfileResponseBody).name).toBe('Jane Doe');
    });

    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .patch('/users/me')
        .send({ name: 'Jane Doe' })
        .expect(401);
    });

    it("never updates another user's profile", async () => {
      const ownerToken = await registerAndLogin(app, 'owner@example.com');
      const otherToken = await registerAndLogin(app, 'other@example.com');

      await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ name: 'Other Name' })
        .expect(200);

      const response = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect((response.body as ProfileResponseBody).name).toBeNull();
    });
  });
});
