import type { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
  CallToolResult,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';
import { TaskStatus } from '@prisma/client';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

interface AccessTokenResponseBody {
  accessToken: string;
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

function parseTasks(result: CallToolResult): { title: string }[] {
  const [first] = result.content;
  if (first?.type !== 'text') {
    throw new Error('Expected a text content block');
  }
  return JSON.parse(first.text) as { title: string }[];
}

function parseTask(result: CallToolResult): {
  id: string;
  title: string;
  status: TaskStatus;
} {
  const [first] = result.content;
  if (first?.type !== 'text') {
    throw new Error('Expected a text content block');
  }
  return JSON.parse(first.text) as {
    id: string;
    title: string;
    status: TaskStatus;
  };
}

function parseResource(result: ReadResourceResult): unknown {
  const [first] = result.contents;
  if (!first || !('text' in first)) {
    throw new Error('Expected a text resource content');
  }
  return JSON.parse(first.text);
}

/**
 * Exercises the in-process `/mcp` HTTP endpoint (`McpModule`) with a real
 * `@modelcontextprotocol/sdk` client over `StreamableHTTPClientTransport` — unlike the other e2e
 * specs, this needs a real listening socket (`app.listen(0)`), since the client transport makes
 * real `fetch()` calls rather than going through `supertest`'s in-memory request shimming.
 * Supersedes the removed standalone `find-tasks-server.ts`/`find-tasks-mcp.e2e-spec.ts` (stdio,
 * per-meeting ownership-gated). `McpAuthGuard` requires a valid Bearer JWT (same validation as the
 * rest of the API), and `TaskTools` now enforces real ownership on top of that identity: `find_tasks`
 * and `tasks://open` only ever return `authUserId`'s own tasks, `upsert_task` always stamps
 * `ownerId: authUserId` (never from its own arguments), and `task://{id}` 403s on a task owned by
 * someone else (see `apps/api/CLAUDE.md`'s Invariants).
 */
describe('/mcp HTTP endpoint (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let baseUrl: URL;
  let authToken: string;
  let authUserId: string;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    await app.listen(0);
    const address = (app.getHttpServer() as Server).address() as AddressInfo;
    baseUrl = new URL(`http://127.0.0.1:${address.port}/mcp`);

    prisma = app.get(PrismaService);
    await prisma.task.deleteMany();
    await prisma.meeting.deleteMany();
    await prisma.user.deleteMany();

    authToken = await registerAndLogin(app, 'mcp-caller@example.com');
    authUserId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: 'mcp-caller@example.com' },
      })
    ).id;
  });

  afterEach(async () => {
    await app.close();
  });

  async function connectClient(token = authToken): Promise<Client> {
    const transport = new StreamableHTTPClientTransport(baseUrl, {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: 'mcp-e2e', version: '0.0.1' });
    await client.connect(transport);
    return client;
  }

  async function createMeeting(title: string): Promise<string> {
    const owner = await prisma.user.create({
      data: { email: `${title.toLowerCase()}@example.com`, password: 'x' },
    });
    const meeting = await prisma.meeting.create({
      data: { title, date: new Date(), participants: [], ownerId: owner.id },
    });
    return meeting.id;
  }

  it('rejects a connection with no Authorization header', async () => {
    const transport = new StreamableHTTPClientTransport(baseUrl);
    const client = new Client({ name: 'mcp-e2e', version: '0.0.1' });
    await expect(client.connect(transport)).rejects.toThrow();
  });

  it('rejects a connection with an invalid token', async () => {
    await expect(connectClient('not-a-valid-jwt')).rejects.toThrow();
  });

  it('lists find_tasks and upsert_task', async () => {
    const client = await connectClient();
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(['find_tasks', 'upsert_task']),
      );
    } finally {
      await client.close();
    }
  });

  it('finds a task seeded directly via prisma, owned by the caller', async () => {
    const meetingId = await createMeeting('Sprint planning');
    await prisma.task.create({
      data: {
        title: 'Draft the roadmap doc',
        sourceMeetingId: meetingId,
        ownerId: authUserId,
      },
    });

    const client = await connectClient();
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

  it('does not find a matching task owned by someone else', async () => {
    const meetingId = await createMeeting('Sprint planning');
    const otherOwner = await prisma.user.create({
      data: { email: 'other-owner@example.com', password: 'x' },
    });
    await prisma.task.create({
      data: {
        title: 'Draft the roadmap doc',
        sourceMeetingId: meetingId,
        ownerId: otherOwner.id,
      },
    });

    const client = await connectClient();
    try {
      const result = await client.callTool({
        name: 'find_tasks',
        arguments: { meetingId, query: 'roadmap doc' },
      });

      expect(result.isError).toBeFalsy();
      expect(parseTasks(result as CallToolResult)).toHaveLength(0);
    } finally {
      await client.close();
    }
  });

  it('creates a new task via upsert_task, owned by the caller regardless of arguments', async () => {
    const meetingId = await createMeeting('Sprint planning');

    const client = await connectClient();
    try {
      const result = await client.callTool({
        name: 'upsert_task',
        arguments: {
          meetingId,
          title: 'Draft the roadmap doc',
          // Not part of upsert_task's input schema — proves the server never reads an owner id
          // from tool arguments even if a caller tries to smuggle one in.
          ownerId: 'someone-else',
        },
      });

      expect(result.isError).toBeFalsy();
      const task = parseTask(result as CallToolResult);
      expect(task.title).toBe('Draft the roadmap doc');
      expect(task.status).toBe(TaskStatus.OPEN);

      const stored = await prisma.task.findUnique({ where: { id: task.id } });
      expect(stored?.sourceMeetingId).toBe(meetingId);
      expect(stored?.ownerId).toBe(authUserId);
    } finally {
      await client.close();
    }
  });

  it('updates the matching existing task instead of duplicating it', async () => {
    const meetingId = await createMeeting('Sprint planning');
    const existing = await prisma.task.create({
      data: {
        title: 'Draft the roadmap doc',
        sourceMeetingId: meetingId,
        ownerId: authUserId,
      },
    });

    const client = await connectClient();
    try {
      const result = await client.callTool({
        name: 'upsert_task',
        arguments: {
          meetingId,
          title: 'Draft the roadmap doc',
          status: TaskStatus.DONE,
        },
      });

      expect(result.isError).toBeFalsy();
      const task = parseTask(result as CallToolResult);
      expect(task.id).toBe(existing.id);
      expect(task.status).toBe(TaskStatus.DONE);
      expect(await prisma.task.count()).toBe(1);
    } finally {
      await client.close();
    }
  });

  it('creates a new task instead of updating a similarly-titled one owned by someone else', async () => {
    const meetingId = await createMeeting('Sprint planning');
    const otherOwner = await prisma.user.create({
      data: { email: 'other-owner-2@example.com', password: 'x' },
    });
    await prisma.task.create({
      data: {
        title: 'Draft the roadmap doc',
        sourceMeetingId: meetingId,
        ownerId: otherOwner.id,
      },
    });

    const client = await connectClient();
    try {
      const result = await client.callTool({
        name: 'upsert_task',
        arguments: { meetingId, title: 'Draft the roadmap doc' },
      });

      expect(result.isError).toBeFalsy();
      const task = parseTask(result as CallToolResult);
      expect(await prisma.task.count()).toBe(2);

      const created = await prisma.task.findUnique({
        where: { id: task.id },
      });
      expect(created?.ownerId).toBe(authUserId);
    } finally {
      await client.close();
    }
  });

  it('lists the tasks://open and task://{id} resources', async () => {
    const client = await connectClient();
    try {
      const { resources } = await client.listResources();
      expect(resources.map((resource) => resource.uri)).toContain(
        'tasks://open',
      );

      const { resourceTemplates } = await client.listResourceTemplates();
      expect(
        resourceTemplates.map((template) => template.uriTemplate),
      ).toContain('task://{id}');
    } finally {
      await client.close();
    }
  });

  it("reads tasks://open, only the caller's own OPEN tasks", async () => {
    const meetingId = await createMeeting('Sprint planning');
    const otherOwner = await prisma.user.create({
      data: { email: 'other-owner-3@example.com', password: 'x' },
    });
    await prisma.task.create({
      data: {
        title: 'Draft the roadmap doc',
        sourceMeetingId: meetingId,
        ownerId: authUserId,
        status: TaskStatus.OPEN,
      },
    });
    await prisma.task.create({
      data: {
        title: 'Already done',
        sourceMeetingId: meetingId,
        ownerId: authUserId,
        status: TaskStatus.DONE,
      },
    });
    await prisma.task.create({
      data: {
        title: "Someone else's open task",
        sourceMeetingId: meetingId,
        ownerId: otherOwner.id,
        status: TaskStatus.OPEN,
      },
    });

    const client = await connectClient();
    try {
      const result = await client.readResource({ uri: 'tasks://open' });
      const tasks = parseResource(result) as { title: string }[];
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('Draft the roadmap doc');
    } finally {
      await client.close();
    }
  });

  it('reads a single task by id via task://{id}, when owned by the caller', async () => {
    const meetingId = await createMeeting('Sprint planning');
    const task = await prisma.task.create({
      data: {
        title: 'Draft the roadmap doc',
        sourceMeetingId: meetingId,
        ownerId: authUserId,
      },
    });

    const client = await connectClient();
    try {
      const result = await client.readResource({
        uri: `task://${task.id}`,
      });
      const read = parseResource(result) as { id: string; title: string };
      expect(read.id).toBe(task.id);
      expect(read.title).toBe('Draft the roadmap doc');
    } finally {
      await client.close();
    }
  });

  it('rejects reading a task://{id} that does not exist', async () => {
    const client = await connectClient();
    try {
      await expect(
        client.readResource({
          uri: 'task://00000000-0000-0000-0000-000000000000',
        }),
      ).rejects.toThrow();
    } finally {
      await client.close();
    }
  });

  it('rejects reading a task://{id} owned by someone else', async () => {
    const meetingId = await createMeeting('Sprint planning');
    const otherOwner = await prisma.user.create({
      data: { email: 'other-owner-4@example.com', password: 'x' },
    });
    const task = await prisma.task.create({
      data: {
        title: 'Draft the roadmap doc',
        sourceMeetingId: meetingId,
        ownerId: otherOwner.id,
      },
    });

    const client = await connectClient();
    try {
      await expect(
        client.readResource({ uri: `task://${task.id}` }),
      ).rejects.toThrow(/Forbidden/);
    } finally {
      await client.close();
    }
  });
});
