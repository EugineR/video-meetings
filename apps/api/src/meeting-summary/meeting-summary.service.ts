import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SummaryStatus } from '@prisma/client';
import { ClaudeAgentService } from '../claude-agent/claude-agent.service';
import { MeetingSummaryRepository } from './meeting-summary.repository';
import { buildSummaryPrompt } from './summary-prompt';
import {
  parseSummaryReply,
  SummaryGenerationResult,
} from './summary-response-parser';

/**
 * Haiku is deliberately cheap/fast here: this is a structured-extraction task (summarize +
 * extract action items/decisions into a defined JSON shape), not open-ended reasoning, and it
 * runs as a background job on every recording that finishes transcribing.
 */
const SUMMARY_MODEL = 'claude-haiku-4-5';

@Injectable()
export class MeetingSummaryService {
  private readonly logger = new Logger(MeetingSummaryService.name);

  constructor(
    private readonly claudeAgentService: ClaudeAgentService,
    private readonly meetingSummaryRepository: MeetingSummaryRepository,
  ) {}

  /**
   * Runs after a recording of this meeting reaches a terminal transcription status (`READY` or
   * `FAILED`), outside the HTTP request that caused it (mirrors
   * `UploadRecordingHandler.transcribeInBackground`) — the meeting this run started for may
   * already have been deleted by the time each step below is ready to write, so every write is
   * conditioned on the meeting still existing via `MeetingSummaryRepository`
   * (`startProcessing`/`updateStatusIfCurrent`), which are no-ops once it doesn't.
   *
   * `readyTranscripts` is every currently-`READY` recording's transcript for this meeting, already
   * ordered by `MeetingRecording.createdAt` (the caller derives it fresh from the database rather
   * than accumulating it across calls) — `FAILED` recordings are excluded by the caller before this
   * is ever invoked. Re-running the fold over the full ordered list on every call, rather than
   * appending only the single newest transcript to whatever was last persisted, keeps the result
   * correct even when recordings finish transcribing out of the order they were created in, and
   * means a call triggered by nothing but a `FAILED` transition (see below) still recomputes the
   * right thing.
   *
   * `allRecordingsTerminal` tells this run whether every one of the meeting's recordings (`READY`
   * or `FAILED`) has now finished, in which case a successful run settles the summary at `READY`;
   * otherwise it settles back at `PENDING` to await the recording(s) still transcribing. Callers
   * must invoke this on a `FAILED` transition too (not just `READY`), or a meeting whose last
   * recording to finish happens to fail would stay stuck at `PENDING` forever even though its
   * earlier, successfully transcribed recordings already have a summary.
   *
   * When `readyTranscripts` is empty (no recording has reached `READY` yet, e.g. every recording so
   * far has failed transcription), this is a no-op: there is nothing to summarize, so no
   * `MeetingSummary` row is created and none is left in a processing state — the meeting simply has
   * no summary.
   */
  async generateForMeeting(
    meetingId: string,
    readyTranscripts: string[],
    allRecordingsTerminal: boolean,
  ): Promise<void> {
    if (readyTranscripts.length === 0) {
      return;
    }

    const started =
      await this.meetingSummaryRepository.startProcessing(meetingId);
    if (!started) {
      return;
    }

    try {
      let result: SummaryGenerationResult | undefined;
      for (const transcriptText of readyTranscripts) {
        result = await this.summarize(transcriptText, result);
      }

      await this.meetingSummaryRepository.updateStatusIfCurrent(meetingId, {
        status: allRecordingsTerminal
          ? SummaryStatus.READY
          : SummaryStatus.PENDING,
        summaryText: result!.summaryText,
        actionItems: result!.actionItems as unknown as Prisma.InputJsonValue,
        decisions: result!.decisions,
      });
    } catch (err) {
      this.logger.error(
        `Summary generation failed for meeting ${meetingId}`,
        err instanceof Error ? err.stack : err,
      );
      await this.meetingSummaryRepository.updateStatusIfCurrent(meetingId, {
        status: SummaryStatus.FAILED,
      });
    }
  }

  /**
   * Calls `ClaudeAgentService` with a prompt asking for a defined JSON shape and parses/validates
   * the reply. `tools: []` is required — see `ClaudeAgentService`'s own doc comment — this call
   * wants a plain structured text reply, not an agent with Bash/file access. Throws a descriptive
   * error (via `parseSummaryReply`) when the reply can't be parsed/validated, for
   * `generateForMeeting` to catch and mark the run `FAILED`.
   *
   * `previous` — when given — is the summary/action items/decisions folded so far from earlier
   * recordings of the same meeting; the prompt instructs the model to extend and de-duplicate
   * against it rather than restart from scratch.
   */
  async summarize(
    transcriptText: string,
    previous?: SummaryGenerationResult,
  ): Promise<SummaryGenerationResult> {
    const reply = await this.claudeAgentService.ask(
      buildSummaryPrompt(transcriptText, previous),
      { model: SUMMARY_MODEL, tools: [] },
    );
    return parseSummaryReply(reply);
  }
}
