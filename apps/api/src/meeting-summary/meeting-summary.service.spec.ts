import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { SummaryStatus } from '@prisma/client';
import type { ClaudeAgentRunner } from '../claude-agent/claude-agent-runner';
import { ClaudeAgentService } from '../claude-agent/claude-agent.service';
import { MeetingSummaryRepository } from './meeting-summary.repository';
import { MeetingSummaryService } from './meeting-summary.service';

const validReply = JSON.stringify({
  summaryText: 'The team agreed on the Q3 roadmap.',
  actionItems: [
    { description: 'Draft the roadmap doc', assignee: 'Priya' },
    { description: 'Book the kickoff room' },
  ],
  decisions: ['Ship the beta in September'],
});

describe('MeetingSummaryService', () => {
  let runClaudeAgent: jest.Mock<
    ReturnType<ClaudeAgentRunner>,
    [string, Options]
  >;
  let claudeAgentService: ClaudeAgentService;

  beforeEach(() => {
    runClaudeAgent = jest.fn<
      ReturnType<ClaudeAgentRunner>,
      [string, Options]
    >();
    claudeAgentService = new ClaudeAgentService(runClaudeAgent);
  });

  describe('summarize', () => {
    it('calls ClaudeAgentService with tools disabled and parses a valid reply', async () => {
      runClaudeAgent.mockResolvedValue(validReply);
      const service = new MeetingSummaryService(
        claudeAgentService,
        {} as MeetingSummaryRepository,
      );

      const result = await service.summarize(
        'Priya: I will draft the roadmap doc.',
      );

      expect(runClaudeAgent).toHaveBeenCalledTimes(1);
      const [prompt, options] = runClaudeAgent.mock.calls[0];
      expect(prompt).toContain('Priya: I will draft the roadmap doc.');
      expect(options.tools).toEqual([]);
      expect(result).toEqual({
        summaryText: 'The team agreed on the Q3 roadmap.',
        actionItems: [
          { description: 'Draft the roadmap doc', assignee: 'Priya' },
          { description: 'Book the kickoff room' },
        ],
        decisions: ['Ship the beta in September'],
      });
    });

    it('parses a reply wrapped in a markdown code fence', async () => {
      runClaudeAgent.mockResolvedValue('```json\n' + validReply + '\n```');
      const service = new MeetingSummaryService(
        claudeAgentService,
        {} as MeetingSummaryRepository,
      );

      const result = await service.summarize('transcript');

      expect(result.summaryText).toBe('The team agreed on the Q3 roadmap.');
    });

    it('includes the previous result in the prompt when folding in a later recording', async () => {
      runClaudeAgent.mockResolvedValue(validReply);
      const service = new MeetingSummaryService(
        claudeAgentService,
        {} as MeetingSummaryRepository,
      );
      const previous = {
        summaryText: 'Earlier segment: kicked off the roadmap discussion.',
        actionItems: [{ description: 'Send the invite' }],
        decisions: ['Meet weekly'],
      };

      await service.summarize('the second segment transcript', previous);

      const [prompt] = runClaudeAgent.mock.calls[0];
      expect(prompt).toContain(previous.summaryText);
      expect(prompt).toContain(JSON.stringify(previous.actionItems));
      expect(prompt).toContain(JSON.stringify(previous.decisions));
      expect(prompt).toContain('the second segment transcript');
    });

    it('omits the previous-result section from the prompt on the first recording', async () => {
      runClaudeAgent.mockResolvedValue(validReply);
      const service = new MeetingSummaryService(
        claudeAgentService,
        {} as MeetingSummaryRepository,
      );

      await service.summarize('transcript');

      const [prompt] = runClaudeAgent.mock.calls[0];
      expect(prompt).not.toContain('already generated');
      expect(prompt).not.toContain('Previous summary');
    });

    it('throws a descriptive error when the reply is not valid JSON', async () => {
      runClaudeAgent.mockResolvedValue(
        'Sure, here is the summary you asked for.',
      );
      const service = new MeetingSummaryService(
        claudeAgentService,
        {} as MeetingSummaryRepository,
      );

      await expect(service.summarize('transcript')).rejects.toThrow(
        'Failed to parse meeting summary response',
      );
    });

    it('throws a descriptive error when a required field is missing', async () => {
      runClaudeAgent.mockResolvedValue(
        JSON.stringify({ summaryText: 'Summary only, no other fields' }),
      );
      const service = new MeetingSummaryService(
        claudeAgentService,
        {} as MeetingSummaryRepository,
      );

      await expect(service.summarize('transcript')).rejects.toThrow(
        '"actionItems" is missing or not an array',
      );
    });
  });

  describe('generateForMeeting', () => {
    const meetingId = 'meeting-1';
    let startProcessing: jest.Mock;
    let updateStatusIfCurrent: jest.Mock;
    let repository: MeetingSummaryRepository;

    beforeEach(() => {
      startProcessing = jest.fn().mockResolvedValue({ id: 'summary-1' });
      updateStatusIfCurrent = jest.fn().mockResolvedValue(true);
      repository = {
        startProcessing,
        updateStatusIfCurrent,
      } as unknown as MeetingSummaryRepository;
    });

    it('marks the run PROCESSING, then READY with the parsed result when every recording is terminal', async () => {
      runClaudeAgent.mockResolvedValue(validReply);
      const service = new MeetingSummaryService(claudeAgentService, repository);

      await service.generateForMeeting(
        meetingId,
        ['the transcript text'],
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
      });
    });

    it('settles at PENDING (not READY) when another recording is still non-terminal', async () => {
      runClaudeAgent.mockResolvedValue(validReply);
      const service = new MeetingSummaryService(claudeAgentService, repository);

      await service.generateForMeeting(
        meetingId,
        ['the transcript text'],
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
        .mockResolvedValueOnce(validReply)
        .mockResolvedValueOnce(secondReply);
      const service = new MeetingSummaryService(claudeAgentService, repository);

      await service.generateForMeeting(
        meetingId,
        ['first recording transcript', 'second recording transcript'],
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
      });
    });

    it('marks the run FAILED when the model reply cannot be parsed', async () => {
      runClaudeAgent.mockResolvedValue('not json at all');
      const service = new MeetingSummaryService(claudeAgentService, repository);

      await service.generateForMeeting(
        meetingId,
        ['the transcript text'],
        true,
      );

      expect(updateStatusIfCurrent).toHaveBeenCalledWith(meetingId, {
        status: SummaryStatus.FAILED,
      });
    });

    it('marks the run FAILED when the underlying Claude call rejects', async () => {
      runClaudeAgent.mockRejectedValue(new Error('agent crashed'));
      const service = new MeetingSummaryService(claudeAgentService, repository);

      await service.generateForMeeting(
        meetingId,
        ['the transcript text'],
        true,
      );

      expect(updateStatusIfCurrent).toHaveBeenCalledWith(meetingId, {
        status: SummaryStatus.FAILED,
      });
    });

    it('marks a later recording in the fold FAILED without persisting a partial result', async () => {
      runClaudeAgent
        .mockResolvedValueOnce(validReply)
        .mockResolvedValueOnce('not json at all');
      const service = new MeetingSummaryService(claudeAgentService, repository);

      await service.generateForMeeting(
        meetingId,
        ['first recording transcript', 'second recording transcript'],
        true,
      );

      expect(updateStatusIfCurrent).toHaveBeenCalledTimes(1);
      expect(updateStatusIfCurrent).toHaveBeenCalledWith(meetingId, {
        status: SummaryStatus.FAILED,
      });
    });

    it('never calls Claude when the meeting has already been deleted', async () => {
      startProcessing.mockResolvedValue(null);
      const service = new MeetingSummaryService(claudeAgentService, repository);

      await service.generateForMeeting(
        meetingId,
        ['the transcript text'],
        true,
      );

      expect(runClaudeAgent).not.toHaveBeenCalled();
      expect(updateStatusIfCurrent).not.toHaveBeenCalled();
    });

    it('never starts processing (and never persists a summary) when there are no READY recordings yet', async () => {
      const service = new MeetingSummaryService(claudeAgentService, repository);

      await service.generateForMeeting(meetingId, [], false);

      expect(startProcessing).not.toHaveBeenCalled();
      expect(runClaudeAgent).not.toHaveBeenCalled();
      expect(updateStatusIfCurrent).not.toHaveBeenCalled();
    });

    it('never starts processing when every recording has failed transcription', async () => {
      const service = new MeetingSummaryService(claudeAgentService, repository);

      await service.generateForMeeting(meetingId, [], true);

      expect(startProcessing).not.toHaveBeenCalled();
      expect(runClaudeAgent).not.toHaveBeenCalled();
      expect(updateStatusIfCurrent).not.toHaveBeenCalled();
    });

    it('does not persist a result once the meeting is deleted mid-run, after Claude replies', async () => {
      runClaudeAgent.mockResolvedValue(validReply);
      updateStatusIfCurrent.mockResolvedValue(false);
      const service = new MeetingSummaryService(claudeAgentService, repository);

      await expect(
        service.generateForMeeting(meetingId, ['the transcript text'], true),
      ).resolves.toBeUndefined();

      expect(updateStatusIfCurrent).toHaveBeenCalledWith(meetingId, {
        status: SummaryStatus.READY,
        summaryText: 'The team agreed on the Q3 roadmap.',
        actionItems: [
          { description: 'Draft the roadmap doc', assignee: 'Priya' },
          { description: 'Book the kickoff room' },
        ],
        decisions: ['Ship the beta in September'],
      });
    });
  });
});
