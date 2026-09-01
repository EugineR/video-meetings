import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { SummaryStatus } from '@prisma/client';
import type {
  ClaudeAgentReply,
  ClaudeAgentRunner,
} from '../claude-agent/claude-agent-runner';
import { ClaudeAgentService } from '../claude-agent/claude-agent.service';
import { MEETING_ALLOWED_TOOLS } from '../meeting-tools';
import { TaskService } from '../tasks/tasks.service';
import { MeetingSummaryRepository } from './meeting-summary.repository';
import { MeetingSummaryService } from './meeting-summary.service';
import { SUMMARY_OUTPUT_JSON_SCHEMA } from './summary-response-parser';

const validReplyPayload = {
  summaryText: 'The team agreed on the Q3 roadmap.',
  actionItems: [
    { description: 'Draft the roadmap doc', assignee: 'Priya' },
    { description: 'Book the kickoff room' },
  ],
  decisions: ['Ship the beta in September'],
};
const validReply = JSON.stringify(validReplyPayload);

/** Wraps a raw text reply as the `ClaudeAgentReply` shape `ClaudeAgentRunner` now resolves with. */
function textReply(text: string): ClaudeAgentReply {
  return { text, structuredOutput: undefined };
}

describe('MeetingSummaryService', () => {
  const meetingId = 'meeting-1';
  const ownerId = 'owner-1';
  let runClaudeAgent: jest.Mock<
    ReturnType<ClaudeAgentRunner>,
    [string, Options]
  >;
  let claudeAgentService: ClaudeAgentService;
  let taskService: TaskService;

  beforeEach(() => {
    runClaudeAgent = jest.fn<
      ReturnType<ClaudeAgentRunner>,
      [string, Options]
    >();
    claudeAgentService = new ClaudeAgentService(runClaudeAgent);
    taskService = {} as TaskService;
  });

  describe('summarize', () => {
    it('calls ClaudeAgentService with only the meeting tools allowed and parses a valid reply', async () => {
      runClaudeAgent.mockResolvedValue(textReply(validReply));
      const service = new MeetingSummaryService(
        claudeAgentService,
        {} as MeetingSummaryRepository,
        taskService,
      );

      const result = await service.summarize(
        meetingId,
        ownerId,
        'Priya: I will draft the roadmap doc.',
      );

      expect(runClaudeAgent).toHaveBeenCalledTimes(1);
      const [prompt, options] = runClaudeAgent.mock.calls[0];
      expect(prompt).toContain('Priya: I will draft the roadmap doc.');
      expect(prompt).not.toContain(meetingId);
      expect(options.tools).toEqual([]);
      expect(options.allowedTools).toEqual(MEETING_ALLOWED_TOOLS);
      expect(options.mcpServers).toHaveProperty('meeting');
      expect(options.outputFormat).toEqual({
        type: 'json_schema',
        schema: SUMMARY_OUTPUT_JSON_SCHEMA,
      });
      expect(typeof options.systemPrompt).toBe('string');
      expect(options.systemPrompt).toContain('find_tasks');
      expect(result).toEqual(validReplyPayload);
    });

    it('parses structuredOutput instead of text when the SDK sets it', async () => {
      runClaudeAgent.mockResolvedValue({
        text: 'placeholder',
        structuredOutput: validReplyPayload,
      });
      const service = new MeetingSummaryService(
        claudeAgentService,
        {} as MeetingSummaryRepository,
        taskService,
      );

      const result = await service.summarize(meetingId, ownerId, 'transcript');

      expect(result).toEqual(validReplyPayload);
    });

    it('parses a reply wrapped in a markdown code fence', async () => {
      runClaudeAgent.mockResolvedValue(
        textReply('```json\n' + validReply + '\n```'),
      );
      const service = new MeetingSummaryService(
        claudeAgentService,
        {} as MeetingSummaryRepository,
        taskService,
      );

      const result = await service.summarize(meetingId, ownerId, 'transcript');

      expect(result.summaryText).toBe('The team agreed on the Q3 roadmap.');
    });

    it('includes the previous result in the prompt when folding in a later recording', async () => {
      runClaudeAgent.mockResolvedValue(textReply(validReply));
      const service = new MeetingSummaryService(
        claudeAgentService,
        {} as MeetingSummaryRepository,
        taskService,
      );
      const previous = {
        summaryText: 'Earlier segment: kicked off the roadmap discussion.',
        actionItems: [{ description: 'Send the invite' }],
        decisions: ['Meet weekly'],
      };

      await service.summarize(
        meetingId,
        ownerId,
        'the second segment transcript',
        previous,
      );

      const [prompt] = runClaudeAgent.mock.calls[0];
      expect(prompt).toContain(previous.summaryText);
      expect(prompt).toContain(JSON.stringify(previous.actionItems));
      expect(prompt).toContain(JSON.stringify(previous.decisions));
      expect(prompt).toContain('the second segment transcript');
    });

    it('omits the previous-result section from the prompt on the first recording', async () => {
      runClaudeAgent.mockResolvedValue(textReply(validReply));
      const service = new MeetingSummaryService(
        claudeAgentService,
        {} as MeetingSummaryRepository,
        taskService,
      );

      await service.summarize(meetingId, ownerId, 'transcript');

      const [prompt] = runClaudeAgent.mock.calls[0];
      expect(prompt).not.toContain('already generated');
      expect(prompt).not.toContain('Previous summary');
    });

    it('throws a descriptive error when the reply is not valid JSON', async () => {
      runClaudeAgent.mockResolvedValue(
        textReply('Sure, here is the summary you asked for.'),
      );
      const service = new MeetingSummaryService(
        claudeAgentService,
        {} as MeetingSummaryRepository,
        taskService,
      );

      await expect(
        service.summarize(meetingId, ownerId, 'transcript'),
      ).rejects.toThrow('Failed to parse meeting summary response');
    });

    it('throws a descriptive error when a required field is missing', async () => {
      runClaudeAgent.mockResolvedValue(
        textReply(
          JSON.stringify({ summaryText: 'Summary only, no other fields' }),
        ),
      );
      const service = new MeetingSummaryService(
        claudeAgentService,
        {} as MeetingSummaryRepository,
        taskService,
      );

      await expect(
        service.summarize(meetingId, ownerId, 'transcript'),
      ).rejects.toThrow('"actionItems" is missing or not an array');
    });

    it('retries and recovers once a later attempt returns a valid reply', async () => {
      runClaudeAgent
        .mockResolvedValueOnce(textReply('not json at all'))
        .mockResolvedValueOnce(textReply(validReply));
      const service = new MeetingSummaryService(
        claudeAgentService,
        {} as MeetingSummaryRepository,
        taskService,
      );

      const result = await service.summarize(meetingId, ownerId, 'transcript');

      expect(result).toEqual(validReplyPayload);
      expect(runClaudeAgent).toHaveBeenCalledTimes(2);
    });

    it('gives up after MAX_SUMMARY_ATTEMPTS consecutive invalid replies', async () => {
      runClaudeAgent.mockResolvedValue(textReply('not json at all'));
      const service = new MeetingSummaryService(
        claudeAgentService,
        {} as MeetingSummaryRepository,
        taskService,
      );

      await expect(
        service.summarize(meetingId, ownerId, 'transcript'),
      ).rejects.toThrow('Failed to parse meeting summary response');
      expect(runClaudeAgent).toHaveBeenCalledTimes(3);
    });
  });

  describe('generateForMeeting', () => {
    let findByMeetingId: jest.Mock;
    let startProcessing: jest.Mock;
    let updateStatusIfCurrent: jest.Mock;
    let deleteIfExists: jest.Mock;
    let repository: MeetingSummaryRepository;

    beforeEach(() => {
      findByMeetingId = jest.fn().mockResolvedValue(null);
      startProcessing = jest.fn().mockResolvedValue({ id: 'summary-1' });
      updateStatusIfCurrent = jest.fn().mockResolvedValue(true);
      deleteIfExists = jest.fn().mockResolvedValue(undefined);
      repository = {
        findByMeetingId,
        startProcessing,
        updateStatusIfCurrent,
        deleteIfExists,
      } as unknown as MeetingSummaryRepository;
    });

    it('marks the run PROCESSING, then READY with the parsed result when every recording is terminal', async () => {
      runClaudeAgent.mockResolvedValue(textReply(validReply));
      const service = new MeetingSummaryService(
        claudeAgentService,
        repository,
        taskService,
      );

      await service.generateForMeeting(
        meetingId,
        ownerId,
        [{ id: 'rec-1', transcriptText: 'the transcript text' }],
        true,
      );

      expect(startProcessing).toHaveBeenCalledWith(meetingId);
      expect(updateStatusIfCurrent).toHaveBeenCalledWith(meetingId, {
        status: SummaryStatus.READY,
        summaryText: 'The team agreed on the Q3 roadmap.',
        actionItems: [
          { description: 'Draft the roadmap doc', assignee: 'Priya' },
          { description: 'Book the kickoff room' },
        ],
        decisions: ['Ship the beta in September'],
        foldedRecordingIds: ['rec-1'],
      });
    });

    it('settles at PENDING (not READY) when another recording is still non-terminal', async () => {
      runClaudeAgent.mockResolvedValue(textReply(validReply));
      const service = new MeetingSummaryService(
        claudeAgentService,
        repository,
        taskService,
      );

      await service.generateForMeeting(
        meetingId,
        ownerId,
        [{ id: 'rec-1', transcriptText: 'the transcript text' }],
        false,
      );

      expect(updateStatusIfCurrent).toHaveBeenCalledWith(
        meetingId,
        expect.objectContaining({ status: SummaryStatus.PENDING }),
      );
    });

    it("folds the meeting-summary recordings in order, threading each result as the next prompt's previous result", async () => {
      const secondReply = JSON.stringify({
        summaryText: 'Extended: also covered the budget.',
        actionItems: [
          { description: 'Draft the roadmap doc', assignee: 'Priya' },
          { description: 'Book the kickoff room' },
          { description: 'Approve the budget' },
        ],
        decisions: ['Ship the beta in September', 'Cap spend at $10k'],
      });
      runClaudeAgent
        .mockResolvedValueOnce(textReply(validReply))
        .mockResolvedValueOnce(textReply(secondReply));
      const service = new MeetingSummaryService(
        claudeAgentService,
        repository,
        taskService,
      );

      await service.generateForMeeting(
        meetingId,
        ownerId,
        [
          { id: 'rec-1', transcriptText: 'first recording transcript' },
          { id: 'rec-2', transcriptText: 'second recording transcript' },
        ],
        true,
      );

      expect(runClaudeAgent).toHaveBeenCalledTimes(2);
      const [firstPrompt] = runClaudeAgent.mock.calls[0];
      expect(firstPrompt).toContain('first recording transcript');
      expect(firstPrompt).not.toContain('Previous summary');

      const [secondPrompt] = runClaudeAgent.mock.calls[1];
      expect(secondPrompt).toContain('second recording transcript');
      expect(secondPrompt).toContain('The team agreed on the Q3 roadmap.');

      expect(updateStatusIfCurrent).toHaveBeenCalledWith(meetingId, {
        status: SummaryStatus.READY,
        summaryText: 'Extended: also covered the budget.',
        actionItems: [
          { description: 'Draft the roadmap doc', assignee: 'Priya' },
          { description: 'Book the kickoff room' },
          { description: 'Approve the budget' },
        ],
        decisions: ['Ship the beta in September', 'Cap spend at $10k'],
        foldedRecordingIds: ['rec-1', 'rec-2'],
      });
    });

    it('marks the run FAILED when the model reply cannot be parsed', async () => {
      runClaudeAgent.mockResolvedValue(textReply('not json at all'));
      const service = new MeetingSummaryService(
        claudeAgentService,
        repository,
        taskService,
      );

      await service.generateForMeeting(
        meetingId,
        ownerId,
        [{ id: 'rec-1', transcriptText: 'the transcript text' }],
        true,
      );

      expect(updateStatusIfCurrent).toHaveBeenCalledWith(meetingId, {
        status: SummaryStatus.FAILED,
      });
    });

    it('retries and then marks the run FAILED when the underlying Claude call rejects', async () => {
      runClaudeAgent.mockRejectedValue(new Error('agent crashed'));
      const service = new MeetingSummaryService(
        claudeAgentService,
        repository,
        taskService,
      );

      await service.generateForMeeting(
        meetingId,
        ownerId,
        [{ id: 'rec-1', transcriptText: 'the transcript text' }],
        true,
      );

      // The SDK call itself throwing must be retried the same as an invalid reply — not just a
      // parse failure — since it's exactly the kind of transient failure MAX_SUMMARY_ATTEMPTS
      // exists to tolerate.
      expect(runClaudeAgent).toHaveBeenCalledTimes(3);
      expect(updateStatusIfCurrent).toHaveBeenCalledWith(meetingId, {
        status: SummaryStatus.FAILED,
      });
    });

    it('marks a later recording in the fold FAILED without persisting a partial result', async () => {
      runClaudeAgent
        .mockResolvedValueOnce(textReply(validReply))
        .mockResolvedValueOnce(textReply('not json at all'));
      const service = new MeetingSummaryService(
        claudeAgentService,
        repository,
        taskService,
      );

      await service.generateForMeeting(
        meetingId,
        ownerId,
        [
          { id: 'rec-1', transcriptText: 'first recording transcript' },
          { id: 'rec-2', transcriptText: 'second recording transcript' },
        ],
        true,
      );

      expect(updateStatusIfCurrent).toHaveBeenCalledTimes(1);
      expect(updateStatusIfCurrent).toHaveBeenCalledWith(meetingId, {
        status: SummaryStatus.FAILED,
      });
    });

    it('never calls Claude when the meeting has already been deleted', async () => {
      startProcessing.mockResolvedValue(null);
      const service = new MeetingSummaryService(
        claudeAgentService,
        repository,
        taskService,
      );

      await service.generateForMeeting(
        meetingId,
        ownerId,
        [{ id: 'rec-1', transcriptText: 'the transcript text' }],
        true,
      );

      expect(runClaudeAgent).not.toHaveBeenCalled();
      expect(updateStatusIfCurrent).not.toHaveBeenCalled();
    });

    it('never starts processing (and clears any existing row) when there are no READY recordings yet', async () => {
      const service = new MeetingSummaryService(
        claudeAgentService,
        repository,
        taskService,
      );

      await service.generateForMeeting(meetingId, ownerId, [], false);

      expect(startProcessing).not.toHaveBeenCalled();
      expect(runClaudeAgent).not.toHaveBeenCalled();
      expect(updateStatusIfCurrent).not.toHaveBeenCalled();
      expect(deleteIfExists).toHaveBeenCalledWith(meetingId);
    });

    it('never starts processing when every recording has failed transcription', async () => {
      const service = new MeetingSummaryService(
        claudeAgentService,
        repository,
        taskService,
      );

      await service.generateForMeeting(meetingId, ownerId, [], true);

      expect(startProcessing).not.toHaveBeenCalled();
      expect(runClaudeAgent).not.toHaveBeenCalled();
      expect(updateStatusIfCurrent).not.toHaveBeenCalled();
      expect(deleteIfExists).toHaveBeenCalledWith(meetingId);
    });

    it('does not persist a result once the meeting is deleted mid-run, after Claude replies', async () => {
      runClaudeAgent.mockResolvedValue(textReply(validReply));
      updateStatusIfCurrent.mockResolvedValue(false);
      const service = new MeetingSummaryService(
        claudeAgentService,
        repository,
        taskService,
      );

      await expect(
        service.generateForMeeting(
          meetingId,
          ownerId,
          [{ id: 'rec-1', transcriptText: 'the transcript text' }],
          true,
        ),
      ).resolves.toBeUndefined();

      expect(updateStatusIfCurrent).toHaveBeenCalledWith(meetingId, {
        status: SummaryStatus.READY,
        summaryText: 'The team agreed on the Q3 roadmap.',
        actionItems: [
          { description: 'Draft the roadmap doc', assignee: 'Priya' },
          { description: 'Book the kickoff room' },
        ],
        decisions: ['Ship the beta in September'],
        foldedRecordingIds: ['rec-1'],
      });
    });

    it('resumes from the persisted result instead of refolding when new recordings only extend the folded set', async () => {
      findByMeetingId.mockResolvedValue({
        summaryText: 'The team agreed on the Q3 roadmap.',
        actionItems: [
          { description: 'Draft the roadmap doc', assignee: 'Priya' },
          { description: 'Book the kickoff room' },
        ],
        decisions: ['Ship the beta in September'],
        foldedRecordingIds: ['rec-1'],
      });
      const secondReply = JSON.stringify({
        summaryText: 'Extended: also covered the budget.',
        actionItems: [
          { description: 'Draft the roadmap doc', assignee: 'Priya' },
          { description: 'Book the kickoff room' },
          { description: 'Approve the budget' },
        ],
        decisions: ['Ship the beta in September', 'Cap spend at $10k'],
      });
      runClaudeAgent.mockResolvedValue(textReply(secondReply));
      const service = new MeetingSummaryService(
        claudeAgentService,
        repository,
        taskService,
      );

      await service.generateForMeeting(
        meetingId,
        ownerId,
        [
          { id: 'rec-1', transcriptText: 'first recording transcript' },
          { id: 'rec-2', transcriptText: 'second recording transcript' },
        ],
        true,
      );

      expect(runClaudeAgent).toHaveBeenCalledTimes(1);
      const [prompt] = runClaudeAgent.mock.calls[0];
      expect(prompt).toContain('second recording transcript');
      expect(prompt).not.toContain('first recording transcript');
      expect(prompt).toContain('The team agreed on the Q3 roadmap.');

      expect(updateStatusIfCurrent).toHaveBeenCalledWith(meetingId, {
        status: SummaryStatus.READY,
        summaryText: 'Extended: also covered the budget.',
        actionItems: [
          { description: 'Draft the roadmap doc', assignee: 'Priya' },
          { description: 'Book the kickoff room' },
          { description: 'Approve the budget' },
        ],
        decisions: ['Ship the beta in September', 'Cap spend at $10k'],
        foldedRecordingIds: ['rec-1', 'rec-2'],
      });
    });

    it('skips calling Claude entirely when the ready set is unchanged (e.g. a FAILED-only transition)', async () => {
      findByMeetingId.mockResolvedValue({
        summaryText: 'The team agreed on the Q3 roadmap.',
        actionItems: [
          { description: 'Draft the roadmap doc', assignee: 'Priya' },
        ],
        decisions: ['Ship the beta in September'],
        foldedRecordingIds: ['rec-1'],
      });
      const service = new MeetingSummaryService(
        claudeAgentService,
        repository,
        taskService,
      );

      await service.generateForMeeting(
        meetingId,
        ownerId,
        [{ id: 'rec-1', transcriptText: 'first recording transcript' }],
        true,
      );

      expect(runClaudeAgent).not.toHaveBeenCalled();
      expect(updateStatusIfCurrent).toHaveBeenCalledWith(meetingId, {
        status: SummaryStatus.READY,
        summaryText: 'The team agreed on the Q3 roadmap.',
        actionItems: [
          { description: 'Draft the roadmap doc', assignee: 'Priya' },
        ],
        decisions: ['Ship the beta in September'],
        foldedRecordingIds: ['rec-1'],
      });
    });

    it('falls back to a full refold when a recording finished out of order (not a suffix append)', async () => {
      findByMeetingId.mockResolvedValue({
        summaryText: 'Existing summary covering only rec-2.',
        actionItems: [],
        decisions: [],
        foldedRecordingIds: ['rec-2'],
      });
      runClaudeAgent
        .mockResolvedValueOnce(textReply(validReply))
        .mockResolvedValueOnce(
          textReply(
            JSON.stringify({
              summaryText: 'Refolded from scratch.',
              actionItems: [],
              decisions: [],
            }),
          ),
        );
      const service = new MeetingSummaryService(
        claudeAgentService,
        repository,
        taskService,
      );

      await service.generateForMeeting(
        meetingId,
        ownerId,
        [
          { id: 'rec-1', transcriptText: 'earlier recording, finished late' },
          { id: 'rec-2', transcriptText: 'already-folded recording' },
        ],
        true,
      );

      expect(runClaudeAgent).toHaveBeenCalledTimes(2);
      const [firstPrompt] = runClaudeAgent.mock.calls[0];
      expect(firstPrompt).toContain('earlier recording, finished late');
      expect(firstPrompt).not.toContain('Existing summary covering only');

      expect(updateStatusIfCurrent).toHaveBeenCalledWith(
        meetingId,
        expect.objectContaining({
          summaryText: 'Refolded from scratch.',
          foldedRecordingIds: ['rec-1', 'rec-2'],
        }),
      );
    });

    it('falls back to a full refold when the ready set shrank (a recording was deleted)', async () => {
      findByMeetingId.mockResolvedValue({
        summaryText: 'Existing summary covering rec-1 and rec-2.',
        actionItems: [],
        decisions: [],
        foldedRecordingIds: ['rec-1', 'rec-2'],
      });
      runClaudeAgent.mockResolvedValue(
        textReply(
          JSON.stringify({
            summaryText: 'Refolded after a deletion.',
            actionItems: [],
            decisions: [],
          }),
        ),
      );
      const service = new MeetingSummaryService(
        claudeAgentService,
        repository,
        taskService,
      );

      await service.generateForMeeting(
        meetingId,
        ownerId,
        [{ id: 'rec-1', transcriptText: 'the only remaining recording' }],
        true,
      );

      expect(runClaudeAgent).toHaveBeenCalledTimes(1);
      const [prompt] = runClaudeAgent.mock.calls[0];
      expect(prompt).not.toContain('Existing summary covering');

      expect(updateStatusIfCurrent).toHaveBeenCalledWith(
        meetingId,
        expect.objectContaining({
          summaryText: 'Refolded after a deletion.',
          foldedRecordingIds: ['rec-1'],
        }),
      );
    });

    it('does not seed a full refold with stale content when foldedRecordingIds is empty but summaryText is not', async () => {
      // This state happens when an earlier run's `update_meeting` tool call wrote content
      // mid-fold (MeetingSummaryRepository.upsertContent, which never touches
      // foldedRecordingIds) and that run then failed before its own trailing write — the only
      // thing that sets foldedRecordingIds — ever ran. An empty foldedRecordingIds is vacuously a
      // "prefix" of any id list, so without the fix this stale summaryText would get seeded into
      // what should be a clean from-scratch fold.
      findByMeetingId.mockResolvedValue({
        summaryText: 'Stale content from a mid-fold update_meeting call.',
        actionItems: [{ description: 'Stale action item' }],
        decisions: ['Stale decision'],
        foldedRecordingIds: [],
      });
      runClaudeAgent.mockResolvedValue(
        textReply(
          JSON.stringify({
            summaryText: 'Clean refold, no stale content.',
            actionItems: [],
            decisions: [],
          }),
        ),
      );
      const service = new MeetingSummaryService(
        claudeAgentService,
        repository,
        taskService,
      );

      await service.generateForMeeting(
        meetingId,
        ownerId,
        [{ id: 'rec-1', transcriptText: 'the transcript text' }],
        true,
      );

      const [prompt] = runClaudeAgent.mock.calls[0];
      expect(prompt).not.toContain('Stale content from a mid-fold');
      expect(prompt).not.toContain('Previous summary so far');

      expect(updateStatusIfCurrent).toHaveBeenCalledWith(meetingId, {
        status: SummaryStatus.READY,
        summaryText: 'Clean refold, no stale content.',
        actionItems: [],
        decisions: [],
        foldedRecordingIds: ['rec-1'],
      });
    });
  });

  describe('updateContent', () => {
    it('delegates to MeetingSummaryRepository.upsertContent', async () => {
      const upsertContent = jest.fn().mockResolvedValue({ id: 'summary-1' });
      const repository = {
        upsertContent,
      } as unknown as MeetingSummaryRepository;
      const service = new MeetingSummaryService(
        claudeAgentService,
        repository,
        taskService,
      );

      const result = await service.updateContent(
        'meeting-1',
        'The team agreed on the roadmap.',
        ['Ship in September'],
      );

      expect(upsertContent).toHaveBeenCalledWith('meeting-1', {
        summaryText: 'The team agreed on the roadmap.',
        decisions: ['Ship in September'],
      });
      expect(result).toEqual({ id: 'summary-1' });
    });

    it('returns null instead of throwing when the meeting has since been deleted', async () => {
      const upsertContent = jest.fn().mockResolvedValue(null);
      const repository = {
        upsertContent,
      } as unknown as MeetingSummaryRepository;
      const service = new MeetingSummaryService(
        claudeAgentService,
        repository,
        taskService,
      );

      const result = await service.updateContent('meeting-1', 'Summary', []);

      expect(result).toBeNull();
    });
  });
});
