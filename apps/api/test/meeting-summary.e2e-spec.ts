import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import {
  CLAUDE_AGENT_RUNNER,
  ClaudeAgentRunner,
} from '../src/claude-agent/claude-agent-runner';
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
  status: string;
}

interface ActionItemBody {
  description: string;
  assignee?: string;
}

interface MeetingDetailResponseBody {
  recordings: RecordingResponseBody[];
  summary: {
    status: string;
    summaryText: string | null;
    actionItems: ActionItemBody[];
    decisions: string[];
  } | null;
}

const uploadsDir = join(
  tmpdir(),
  `video-meetings-e2e-summary-uploads-${randomUUID()}`,
);

/** A fast-resolving stub in whisper.cpp's own segment-timestamp output format, so `extractTranscriptText` yields plain text. */
const transcribedText = 'Priya: I will draft the roadmap doc.';
const resolvingWhisperRunner: WhisperRunner = () =>
  Promise.resolve(`[00:00:00.000 --> 00:00:02.500] ${transcribedText}`);

/** Never resolves, so transcription (and therefore summarization, which never fires) gets stuck right after PROCESSING. */
const hangingWhisperRunner: WhisperRunner = () => new Promise(() => {});

/** Rejects immediately, driving the recording straight to FAILED without ever reaching READY. */
const failingWhisperRunner: WhisperRunner = () =>
  Promise.reject(new Error('whisper-cli crashed'));

const validSummaryReply = JSON.stringify({
  summaryText: 'The team agreed on the Q3 roadmap.',
  actionItems: [{ description: 'Draft the roadmap doc', assignee: 'Priya' }],
  decisions: ['Ship the beta in September'],
});
const secondSummaryReply = JSON.stringify({
  summaryText: 'The team agreed on the Q3 roadmap and approved the budget.',
  actionItems: [
    { description: 'Draft the roadmap doc', assignee: 'Priya' },
    { description: 'Approve the budget' },
  ],
  decisions: ['Ship the beta in September', 'Cap spend at $10k'],
});
const resolvingClaudeAgentRunner: ClaudeAgentRunner = () =>
  Promise.resolve(validSummaryReply);
const failingClaudeAgentRunner: ClaudeAgentRunner = () =>
  Promise.reject(new Error('agent crashed'));

/**
 * Replies with `validSummaryReply` for a prompt that has no prior result folded in (the meeting's
 * first recording), and `secondSummaryReply` for one that does (`buildSummaryPrompt` only ever
 * includes "Previous summary" when a `previous` result was passed) — driven by prompt content
 * rather than call count so it stays correct regardless of how many times a reconciliation run
 * recomputes the fold from scratch.
 */
const foldAwareClaudeAgentRunner: ClaudeAgentRunner = (prompt) =>
  Promise.resolve(
    prompt.includes('Previous summary')
      ? secondSummaryReply
      : validSummaryReply,
  );

/** A meeting-recording upload whose content marks it to fail transcription — see `contentAwareWhisperRunner`. */
const failingRecordingContents = 'fake mp4 bytes (FAIL_TRANSCRIPTION)';

/**
 * Resolves or rejects based on the uploaded file's own content (read back from disk) rather than
 * call order, so a test with multiple recordings can deterministically control which one fails
 * transcription regardless of how their background jobs happen to interleave.
 */
const contentAwareWhisperRunner: WhisperRunner = (filePath) => {
  const contents = readFileSync(filePath, 'utf8');
  if (contents.includes('FAIL_TRANSCRIPTION')) {
    return Promise.reject(new Error('whisper-cli crashed'));
  }
  return Promise.resolve(`[00:00:00.000 --> 00:00:02.500] ${transcribedText}`);
};

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
  filename = 'recording.mp4',
  contents: Buffer | string = 'fake mp4 bytes',
): Promise<RecordingResponseBody> {
  const response = await request(app.getHttpServer())
    .post(`/meetings/${meetingId}/recordings`)
    .set('Authorization', `Bearer ${token}`)
    .attach('file', Buffer.from(contents), {
      filename,
      contentType: 'video/mp4',
    })
    .expect(201);

  return response.body as RecordingResponseBody;
}

async function getMeetingDetail(
  app: INestApplication<App>,
  token: string,
  meetingId: string,
): Promise<MeetingDetailResponseBody> {
  const response = await request(app.getHttpServer())
    .get(`/meetings/${meetingId}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  return response.body as MeetingDetailResponseBody;
}

/** Polls `GET /meetings/:id` until `predicate` passes or `timeoutMs` elapses, for the background transcription + summarization jobs to settle. */
async function pollMeetingDetail(
  app: INestApplication<App>,
  token: string,
  meetingId: string,
  predicate: (detail: MeetingDetailResponseBody) => boolean,
  timeoutMs = 5000,
  intervalMs = 50,
): Promise<MeetingDetailResponseBody> {
  const deadline = Date.now() + timeoutMs;
  let last: MeetingDetailResponseBody;
  do {
    last = await getMeetingDetail(app, token, meetingId);
    if (predicate(last)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (Date.now() < deadline);

  throw new Error(
    `Timed out waiting for meeting ${meetingId} detail to satisfy the predicate. Last seen: ${JSON.stringify(last)}`,
  );
}

describe('Meeting Summary (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(() => {
    process.env.UPLOADS_DIR = uploadsDir;
  });

  afterAll(() => {
    rmSync(uploadsDir, { recursive: true, force: true });
  });

  async function initApp(
    whisperRunner: WhisperRunner,
    claudeAgentRunner: ClaudeAgentRunner,
  ): Promise<void> {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(WHISPER_RUNNER)
      .useValue(whisperRunner)
      .overrideProvider(CLAUDE_AGENT_RUNNER)
      .useValue(claudeAgentRunner)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.meetingSummary.deleteMany();
    await prisma.meetingRecording.deleteMany();
    await prisma.meeting.deleteMany();
    await prisma.user.deleteMany();
  }

  afterEach(async () => {
    await app.close();
  });

  it('generates and persists a summary once the recording transcript is READY', async () => {
    await initApp(resolvingWhisperRunner, resolvingClaudeAgentRunner);

    const token = await registerAndLogin(app, 'owner@example.com');
    const meetingId = await createMeeting(app, token);

    const beforeUpload = await getMeetingDetail(app, token, meetingId);
    expect(beforeUpload.summary).toBeNull();

    await uploadRecording(app, token, meetingId);

    const detail = await pollMeetingDetail(
      app,
      token,
      meetingId,
      (d) => d.summary?.status === 'READY',
    );

    expect(detail.recordings).toHaveLength(1);
    expect(detail.recordings[0].status).toBe('READY');
    expect(detail.summary).toEqual({
      status: 'READY',
      summaryText: 'The team agreed on the Q3 roadmap.',
      actionItems: [
        { description: 'Draft the roadmap doc', assignee: 'Priya' },
      ],
      decisions: ['Ship the beta in September'],
    });
  });

  it('never generates a summary when the only recording fails transcription', async () => {
    await initApp(failingWhisperRunner, resolvingClaudeAgentRunner);

    const token = await registerAndLogin(app, 'owner@example.com');
    const meetingId = await createMeeting(app, token);

    await uploadRecording(app, token, meetingId);

    const detail = await pollMeetingDetail(
      app,
      token,
      meetingId,
      (d) => d.recordings[0]?.status === 'FAILED',
    );

    expect(detail.summary).toBeNull();
    const summaryRow = await prisma.meetingSummary.findUnique({
      where: { meetingId },
    });
    expect(summaryRow).toBeNull();
  });

  it('marks the summary FAILED (without throwing) when the Claude call itself errors', async () => {
    await initApp(resolvingWhisperRunner, failingClaudeAgentRunner);

    const token = await registerAndLogin(app, 'owner@example.com');
    const meetingId = await createMeeting(app, token);

    await uploadRecording(app, token, meetingId);

    const detail = await pollMeetingDetail(
      app,
      token,
      meetingId,
      (d) => d.summary?.status === 'FAILED',
    );

    expect(detail.summary?.summaryText).toBeNull();
    expect(detail.summary?.actionItems).toEqual([]);
    expect(detail.summary?.decisions).toEqual([]);
  });

  it('leaves summary absent while transcription is still in progress', async () => {
    await initApp(hangingWhisperRunner, resolvingClaudeAgentRunner);

    const token = await registerAndLogin(app, 'owner@example.com');
    const meetingId = await createMeeting(app, token);

    await uploadRecording(app, token, meetingId);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const detail = await getMeetingDetail(app, token, meetingId);
    expect(detail.summary).toBeNull();
  });

  it('extends the summary as a second recording finishes transcribing, without restarting from scratch', async () => {
    await initApp(resolvingWhisperRunner, foldAwareClaudeAgentRunner);

    const token = await registerAndLogin(app, 'owner@example.com');
    const meetingId = await createMeeting(app, token);

    await uploadRecording(
      app,
      token,
      meetingId,
      'first.mp4',
      'first recording bytes',
    );
    const afterFirst = await pollMeetingDetail(
      app,
      token,
      meetingId,
      (d) => d.summary?.status === 'READY',
    );
    expect(afterFirst.summary?.summaryText).toBe(
      'The team agreed on the Q3 roadmap.',
    );

    await uploadRecording(
      app,
      token,
      meetingId,
      'second.mp4',
      'second recording bytes',
    );
    const afterSecond = await pollMeetingDetail(
      app,
      token,
      meetingId,
      (d) =>
        d.recordings.length === 2 &&
        d.recordings.every((r) => r.status === 'READY') &&
        d.summary?.summaryText !== 'The team agreed on the Q3 roadmap.',
    );

    expect(afterSecond.summary).toEqual({
      status: 'READY',
      summaryText: 'The team agreed on the Q3 roadmap and approved the budget.',
      actionItems: [
        { description: 'Draft the roadmap doc', assignee: 'Priya' },
        { description: 'Approve the budget' },
      ],
      decisions: ['Ship the beta in September', 'Cap spend at $10k'],
    });
  });

  it('excludes a FAILED recording from the summary while still settling it to READY', async () => {
    await initApp(contentAwareWhisperRunner, resolvingClaudeAgentRunner);

    const token = await registerAndLogin(app, 'owner@example.com');
    const meetingId = await createMeeting(app, token);

    await uploadRecording(app, token, meetingId, 'ok.mp4', 'fake mp4 bytes');
    await pollMeetingDetail(
      app,
      token,
      meetingId,
      (d) => d.summary?.status === 'READY',
    );

    await uploadRecording(
      app,
      token,
      meetingId,
      'bad.mp4',
      failingRecordingContents,
    );
    const detail = await pollMeetingDetail(
      app,
      token,
      meetingId,
      (d) =>
        d.recordings.length === 2 &&
        d.recordings.some((r) => r.status === 'FAILED'),
    );

    expect(detail.recordings.map((r) => r.status).sort()).toEqual([
      'FAILED',
      'READY',
    ]);
    expect(detail.summary).toEqual({
      status: 'READY',
      summaryText: 'The team agreed on the Q3 roadmap.',
      actionItems: [
        { description: 'Draft the roadmap doc', assignee: 'Priya' },
      ],
      decisions: ['Ship the beta in September'],
    });
  });

  it('never generates a summary when every one of several recordings fails transcription', async () => {
    await initApp(contentAwareWhisperRunner, resolvingClaudeAgentRunner);

    const token = await registerAndLogin(app, 'owner@example.com');
    const meetingId = await createMeeting(app, token);

    await uploadRecording(
      app,
      token,
      meetingId,
      'bad-1.mp4',
      failingRecordingContents,
    );
    await uploadRecording(
      app,
      token,
      meetingId,
      'bad-2.mp4',
      failingRecordingContents,
    );

    const detail = await pollMeetingDetail(
      app,
      token,
      meetingId,
      (d) =>
        d.recordings.length === 2 &&
        d.recordings.every((r) => r.status === 'FAILED'),
    );

    expect(detail.summary).toBeNull();
    const summaryRow = await prisma.meetingSummary.findUnique({
      where: { meetingId },
    });
    expect(summaryRow).toBeNull();
  });
});
