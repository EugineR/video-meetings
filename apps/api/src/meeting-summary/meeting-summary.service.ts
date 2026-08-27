import { Injectable, Logger } from '@nestjs/common';
import { MeetingSummary, Prisma, SummaryStatus } from '@prisma/client';
import { ClaudeAgentService } from '../claude-agent/claude-agent.service';
import {
  createMeetingToolsServer,
  MEETING_ALLOWED_TOOLS,
  MEETING_TOOLS_SERVER_NAME,
} from '../meeting-tools';
import { TaskService } from '../tasks/tasks.service';
import { MeetingSummaryRepository } from './meeting-summary.repository';
import { buildSummaryPrompt } from './summary-prompt';
import {
  parseSummaryReply,
  SUMMARY_OUTPUT_JSON_SCHEMA,
  SummaryGenerationResult,
} from './summary-response-parser';

/**
 * Haiku is deliberately cheap/fast here: this is a structured-extraction task (summarize +
 * extract action items/decisions into a defined JSON shape), not open-ended reasoning, and it
 * runs as a background job on every recording that finishes transcribing.
 */
const SUMMARY_MODEL = 'claude-haiku-4-5';

/**
 * How many times `summarize` re-asks the agent when its reply fails `parseSummaryReply`'s
 * validation (malformed JSON or a shape `outputFormat`'s schema alone didn't catch) before giving
 * up and letting the error propagate to `generateForMeeting`'s `FAILED`-marking catch block.
 */
const MAX_SUMMARY_ATTEMPTS = 3;

/**
 * Governs how `summarize`'s agent run uses the `meeting` MCP tools (see `../meeting-tools`):
 * `find_tasks` before ever creating one — so a recurring action item within the same meeting
 * updates its existing `Task` row instead of duplicating it, while a similarly-titled task the
 * lookup surfaces from a different meeting is only ever informational, never a merge target
 * (`upsert_task` itself enforces that scoping regardless of what this prompt says) — and to
 * ignore transcript remarks that aren't actually action items rather than turning every remark
 * into a task.
 */
const MEETING_AGENT_SYSTEM_PROMPT = `You turn a meeting transcript into tracked tasks and a meeting summary, using the ${MEETING_TOOLS_SERVER_NAME} tools available to you.

Rules:
- Before creating a task, always call find_tasks first to check whether a similar task already exists. find_tasks may return tasks from other meetings too — those are for your awareness only, to avoid restating the same request as if it were new.
- upsert_task only ever creates or updates a task for the current meeting — it can never touch a task belonging to a different meeting, even if find_tasks turned one up.
- Ignore transcript remarks that are not actually action items — never create a task for small talk, questions, or statements that don't ask for future work to be done.`;

@Injectable()
export class MeetingSummaryService {
  private readonly logger = new Logger(MeetingSummaryService.name);

  constructor(
    private readonly claudeAgentService: ClaudeAgentService,
    private readonly meetingSummaryRepository: MeetingSummaryRepository,
    private readonly taskService: TaskService,
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
   * far has failed transcription, or the one recording that had reached `READY` was since deleted),
   * there is nothing to summarize: any existing `MeetingSummary` row is removed — rather than left
   * in place with stale content, or in a processing state — and none is (re)created.
   */
  async generateForMeeting(
    meetingId: string,
    readyTranscripts: string[],
    allRecordingsTerminal: boolean,
  ): Promise<void> {
    if (readyTranscripts.length === 0) {
      await this.meetingSummaryRepository.deleteIfExists(meetingId);
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
        result = await this.summarize(meetingId, transcriptText, result);
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
   * Calls `ClaudeAgentService` with a prompt asking for a defined JSON shape, giving the agent the
   * `meeting` MCP tools (`../meeting-tools`) so it can look up/record `Task` rows and write the
   * meeting's summary itself as it works, then parses/validates the reply. `createMeetingToolsServer`
   * is built with this call's own `meetingId`, not one the model supplies — `upsert_task`/
   * `update_meeting`'s input schemas take no meeting id at all, so nothing in the transcript (or an
   * attempt at prompt injection) can redirect a write to a different meeting. `tools: []` disables
   * the SDK's built-in toolset (Bash/file access, ...) — see `ClaudeAgentService`'s own doc comment —
   * `allowedTools: MEETING_ALLOWED_TOOLS` then opens up exactly the three `meeting` tools and
   * nothing else. `outputFormat` constrains the final reply to `SUMMARY_OUTPUT_JSON_SCHEMA`
   * (mirroring `SummaryGenerationResult`); `parseSummaryReply` still runs on top as a second,
   * defensive check against this app's exact contract (e.g. rejecting an empty
   * `description`, which the JSON Schema alone doesn't).
   *
   * Once `outputFormat` is set, the SDK's plain text `result` may be a placeholder — the turn ends
   * on a tool_result carrier and the real, schema-validated answer arrives as `structuredOutput`
   * (see `ClaudeAgentReply`) — so this reads `structuredOutput` when present and only falls back to
   * `text` when it isn't (e.g. a stubbed runner in a test that doesn't set it).
   *
   * `previous` — when given — is the summary/action items/decisions folded so far from earlier
   * recordings of the same meeting; the prompt instructs the model to extend and de-duplicate
   * against it rather than restart from scratch.
   *
   * If `parseSummaryReply` rejects the reply (malformed JSON, or a shape `outputFormat`'s schema
   * didn't catch), this re-asks the agent with the same prompt/options up to
   * `MAX_SUMMARY_ATTEMPTS` times rather than failing on the first bad reply — Claude occasionally
   * returns a placeholder/truncated `result` instead of the schema-checked `structured_output`.
   * A retried attempt re-running `upsert_task`/`update_meeting` is safe to repeat: `upsert_task`'s
   * dedup is scoped to this same `meetingId` (see `meeting-tools.ts`), and `update_meeting` simply
   * overwrites with what should be the same final content. Only the last attempt's error is
   * thrown, once every attempt has failed.
   */
  async summarize(
    meetingId: string,
    transcriptText: string,
    previous?: SummaryGenerationResult,
  ): Promise<SummaryGenerationResult> {
    const prompt = buildSummaryPrompt(transcriptText, previous);
    const options: Parameters<ClaudeAgentService['ask']>[1] = {
      model: SUMMARY_MODEL,
      tools: [],
      mcpServers: {
        [MEETING_TOOLS_SERVER_NAME]: await createMeetingToolsServer(
          meetingId,
          this.taskService,
          this,
        ),
      },
      allowedTools: MEETING_ALLOWED_TOOLS,
      systemPrompt: MEETING_AGENT_SYSTEM_PROMPT,
      outputFormat: {
        type: 'json_schema',
        schema: SUMMARY_OUTPUT_JSON_SCHEMA,
      },
    };

    for (let attempt = 1; attempt <= MAX_SUMMARY_ATTEMPTS; attempt++) {
      const { text, structuredOutput } = await this.claudeAgentService.ask(
        prompt,
        options,
      );
      const reply =
        structuredOutput !== undefined
          ? JSON.stringify(structuredOutput)
          : text;
      try {
        return parseSummaryReply(reply);
      } catch (err) {
        if (attempt === MAX_SUMMARY_ATTEMPTS) {
          throw err;
        }
        this.logger.warn(
          `summarize attempt ${attempt}/${MAX_SUMMARY_ATTEMPTS} for meeting ${meetingId} got an invalid reply, retrying: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    /* istanbul ignore next -- unreachable: the loop always returns or throws on its last attempt */
    throw new Error('unreachable');
  }

  /**
   * Writes a meeting's `summaryText`/`decisions` directly rather than deriving them from
   * `summarize`'s transcript-driven fold — the entry point `meeting-tools.ts`'s `update_meeting`
   * agent tool calls. Always settles the row at `READY`, creating it if the meeting doesn't have
   * one yet. Returns `null` instead of throwing when the meeting has since been deleted.
   */
  updateContent(
    meetingId: string,
    summaryText: string,
    decisions: string[],
  ): Promise<MeetingSummary | null> {
    return this.meetingSummaryRepository.upsertContent(meetingId, {
      summaryText,
      decisions: decisions,
    });
  }
}
