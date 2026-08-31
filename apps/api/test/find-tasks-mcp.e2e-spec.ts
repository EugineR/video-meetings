import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
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

const FIND_TASKS_SERVER_PATH = join(
  __dirname,
  '../src/mcp/find-tasks-server.ts',
);

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
  title: string,
): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/meetings')
    .set('Authorization', `Bearer ${token}`)
    .send({ title, date: '2026-09-01T10:00:00.000Z', participants: [] })
    .expect(201);

  return (response.body as MeetingResponseBody).id;
}

/**
 * Connects a real `@modelcontextprotocol/sdk` client to the standalone `find_tasks` server over
 * stdio, spawning `find-tasks-server.ts` directly via `ts-node` (transpile-only, purely so each
 * test's spawn is fast — the server itself is still exercised as real compiled behavior, not a
 * mock) rather than requiring a prior `pnpm build`; same underlying mechanism as the
 * `mcp:find-tasks:dev` script. `accessToken` becomes the subprocess's `MCP_ACCESS_TOKEN` env var —
 * the identity every `find_tasks` call in that session is checked against.
 */
async function connectFindTasksClient(accessToken: string): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['-r', 'ts-node/register/transpile-only', FIND_TASKS_SERVER_PATH],
    cwd: join(__dirname, '..'),
    env: { ...process.env, MCP_ACCESS_TOKEN: accessToken },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'find-tasks-e2e', version: '0.0.1' });
  await client.connect(transport);
  return client;
}

function parseTasks(result: CallToolResult): { title: string }[] {
  const [first] = result.content;
  if (first?.type !== 'text') {
    throw new Error('Expected a text content block');
  }
  return JSON.parse(first.text) as { title: string }[];
}

describe('find_tasks MCP server (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.task.deleteMany();
    await prisma.meeting.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(async () => {
    await app.close();
  });

  it("finds a task belonging to the caller's own meeting", async () => {
    const token = await registerAndLogin(app, 'owner@example.com');
    const meetingId = await createMeeting(app, token, 'Sprint planning');
    await prisma.task.create({
      data: { title: 'Draft the roadmap doc', sourceMeetingId: meetingId },
    });

    const client = await connectFindTasksClient(token);
    try {
      const result = await client.callTool({
        name: 'find_tasks',
        arguments: { meetingId, query: 'roadmap doc' },
      });

      expect(result.isError).toBeFalsy();
      const tasks = parseTasks(result as CallToolResult);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('Draft the roadmap doc');
    } finally {
      await client.close();
    }
  });

  it('refuses to search a meeting owned by someone else', async () => {
    const ownerToken = await registerAndLogin(app, 'owner@example.com');
    const otherToken = await registerAndLogin(app, 'other@example.com');
    const meetingId = await createMeeting(app, ownerToken, 'Private planning');
    await prisma.task.create({
      data: { title: 'Draft the roadmap doc', sourceMeetingId: meetingId },
    });

    const client = await connectFindTasksClient(otherToken);
    try {
      const result = await client.callTool({
        name: 'find_tasks',
        arguments: { meetingId, query: 'roadmap doc' },
      });

      expect(result.isError).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('rejects an invalid access token before any tool call can run', async () => {
    await expect(
      (async () => {
        const client = await connectFindTasksClient('not-a-real-token');
        try {
          return await client.callTool({
            name: 'find_tasks',
            arguments: {
              meetingId: '00000000-0000-0000-0000-000000000000',
              query: 'anything',
            },
          });
        } finally {
          await client.close().catch(() => undefined);
        }
      })(),
    ).rejects.toThrow();
  });
});
