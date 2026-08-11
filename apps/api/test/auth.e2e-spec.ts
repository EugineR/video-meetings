import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const JWT_REGEX = /^[\w-]+\.[\w-]+\.[\w-]+$/;

interface AccessTokenResponseBody {
  accessToken: string;
}

describe('Auth (e2e)', () => {
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

  describe('/auth/register (POST)', () => {
    it('creates a new user and returns a JWT access token', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'new-user@example.com', password: 'Password123!' })
        .expect(201);

      const body = response.body as AccessTokenResponseBody;
      expect(Object.keys(body)).toEqual(['accessToken']);
      expect(body.accessToken).toMatch(JWT_REGEX);
    });

    it('rejects registration with an email that is already taken', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'duplicate@example.com', password: 'Password123!' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'duplicate@example.com',
          password: 'AnotherPassword456!',
        })
        .expect(409);
    });

    it('rejects registration with an invalid email', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'not-an-email', password: 'Password123!' })
        .expect(400);
    });

    it('rejects registration with a missing password', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'missing-password@example.com' })
        .expect(400);
    });

    it('rejects registration with a missing email', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ password: 'Password123!' })
        .expect(400);
    });
  });

  describe('/auth/login (POST)', () => {
    const existingUser = {
      email: 'existing-user@example.com',
      password: 'Password123!',
    };

    beforeEach(async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(existingUser)
        .expect(201);
    });

    it('logs in an existing user and returns a JWT access token', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send(existingUser)
        .expect(200);

      const body = response.body as AccessTokenResponseBody;
      expect(Object.keys(body)).toEqual(['accessToken']);
      expect(body.accessToken).toMatch(JWT_REGEX);
    });

    it('rejects login for an email that was never registered', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'unknown@example.com', password: 'Password123!' })
        .expect(401);
    });

    it('rejects login with an incorrect password', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: existingUser.email, password: 'WrongPassword!' })
        .expect(401);
    });

    it('does not create a new user when logging in with an unregistered email', async () => {
      const unregistered = {
        email: 'never-registered@example.com',
        password: 'Password123!',
      };

      await request(app.getHttpServer())
        .post('/auth/login')
        .send(unregistered)
        .expect(401);

      // If login had created the user as a side effect, registering the same
      // email afterwards would now fail with a 409 conflict.
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(unregistered)
        .expect(201);
    });
  });
});
