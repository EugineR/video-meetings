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
  title: string;
  date: string;
  participants: string[];
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

async function registerAndLogin(
  app: INestApplication<App>,
  email: string,
): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ name: 'Test User', email, password: 'Password123!' })
    .expect(201);

  return (response.body as AccessTokenResponseBody).accessToken;
}

describe('Meetings (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.meeting.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('/meetings (POST)', () => {
    it('creates a new meeting for the authenticated user', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');

      const response = await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Sprint planning',
          date: '2026-09-01T10:00:00.000Z',
          participants: ['alice@example.com', 'bob@example.com'],
        })
        .expect(201);

      const body = response.body as MeetingResponseBody;
      expect(body.id).toEqual(expect.any(String));
      expect(body.title).toBe('Sprint planning');
      expect(body.date).toBe('2026-09-01T10:00:00.000Z');
      expect(body.participants).toEqual([
        'alice@example.com',
        'bob@example.com',
      ]);
    });

    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .post('/meetings')
        .send({
          title: 'Sprint planning',
          date: '2026-09-01T10:00:00.000Z',
          participants: [],
        })
        .expect(401);
    });

    it('rejects a missing title', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');

      await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send({ date: '2026-09-01T10:00:00.000Z', participants: [] })
        .expect(400);
    });

    it('rejects a missing date', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');

      await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Sprint planning', participants: [] })
        .expect(400);
    });

    it('rejects an invalid date', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');

      await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Sprint planning',
          date: 'not-a-date',
          participants: [],
        })
        .expect(400);
    });

    it('rejects a non-array participants field', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');

      await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Sprint planning',
          date: '2026-09-01T10:00:00.000Z',
          participants: 'not-an-array',
        })
        .expect(400);
    });

    it('rejects an invalid participant email', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');

      await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Sprint planning',
          date: '2026-09-01T10:00:00.000Z',
          participants: ['not-an-email'],
        })
        .expect(400);
    });
  });

  describe('/meetings (GET)', () => {
    it("returns only the authenticated user's meetings", async () => {
      const ownerToken = await registerAndLogin(app, 'owner@example.com');
      const otherToken = await registerAndLogin(app, 'other@example.com');

      await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          title: 'Owner meeting',
          date: '2026-09-01T10:00:00.000Z',
          participants: [],
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${otherToken}`)
        .send({
          title: 'Other meeting',
          date: '2026-09-02T10:00:00.000Z',
          participants: [],
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get('/meetings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const body = response.body as MeetingResponseBody[];
      expect(body).toHaveLength(1);
      expect(body[0].title).toBe('Owner meeting');
    });

    it('returns an empty array when the user has no meetings', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');

      const response = await request(app.getHttpServer())
        .get('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/meetings').expect(401);
    });
  });

  describe('/meetings/:id (GET)', () => {
    it('returns a meeting owned by the authenticated user', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');

      const createResponse = await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Sprint planning',
          date: '2026-09-01T10:00:00.000Z',
          participants: [],
        })
        .expect(201);

      const created = createResponse.body as MeetingResponseBody;

      const response = await request(app.getHttpServer())
        .get(`/meetings/${created.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body as MeetingResponseBody;
      expect(body.id).toBe(created.id);
      expect(body.title).toBe('Sprint planning');
    });

    it('returns 404 for an id that does not exist', async () => {
      const token = await registerAndLogin(app, 'owner@example.com');

      await request(app.getHttpServer())
        .get('/meetings/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('returns 404 for a meeting owned by another user', async () => {
      const ownerToken = await registerAndLogin(app, 'owner@example.com');
      const otherToken = await registerAndLogin(app, 'other@example.com');

      const createResponse = await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          title: 'Private meeting',
          date: '2026-09-01T10:00:00.000Z',
          participants: [],
        })
        .expect(201);

      const created = createResponse.body as MeetingResponseBody;

      await request(app.getHttpServer())
        .get(`/meetings/${created.id}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });

    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .get('/meetings/00000000-0000-0000-0000-000000000000')
        .expect(401);
    });
  });
});
