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
  ActionItemPayload,
  parseSummaryReply,
  SUMMARY_OUTPUT_JSON_SCHEMA,
  SummaryGenerationResult,
} from './summary-response-parser';

/** One `READY` recording's transcript, as `SummaryReconciliationService` derives it from the DB. */
export interface FoldableRecording {
  id: string;
  transcriptText: string;
}

/**
 * Where `generateForMeeting` should resume folding `readyRecordings` from: `startIndex` is the
 * first recording not yet reflected in `seed` (0 means fold everyone from scratch), and `seed` is
 * the already-persisted result to extend, or `undefined` when there's nothing to extend.
 * `startIndex` and `seed` always agree — `startIndex > 0` never appears without a `seed`, and
 * `startIndex === readyRecordings.length` (nothing new to fold) always comes with one.
 */
interface FoldResumePoint {
  startIndex: number;
  seed?: SummaryGenerationResult;
}

/**
 * Decides how much of `readyRecordings`' fold work (see `generateForMeeting`) can be skipped by
 * reusing `existing`'s already-persisted result, instead of refolding every ready recording from
 * scratch on every run.
 *
 * Resuming is safe only when `existing.foldedRecordingIds` is an exact, in-order PREFIX of
 * `newIds` — i.e. every recording this run considers ready was already folded in, in the same
 * order, and the only thing that changed is that more recordings joined the tail. That covers the
 * common case (recordings finish transcribing roughly in upload order) including the case where
 * nothing changed at all (e.g. a run triggered by an unrelated recording's `FAILED` transition):
 * `startIndex` lands on `newIds.length` and the caller's fold loop simply doesn't run.
 *
 * Anything else — a recording finished out of order and needs to be folded in earlier than the
 * tail, or the ready set shrank (a recording was deleted) — falls back to `startIndex: 0` (no
 * `seed`), which makes the caller refold every ready recording from scratch, exactly like before
 * this resume logic existed. That fallback is what keeps the result correct in those cases: see
 * `generateForMeeting`'s own doc comment for why a full refold is required there.
 */
function resumeFoldFrom(
  existing: MeetingSummary | null,
  newIds: string[],
): FoldResumePoint {
  if (!existing || existing.summaryText === null) {
    return { startIndex: 0 };
  }
  const foldedIds = existing.foldedRecordingIds;
  if (foldedIds.length === 0) {
    // Nothing has ever been successfully folded into this row — e.g. `existing.summaryText` is
    // leftover from an `update_meeting` tool call mid-fold on a run that then failed before its
    // own trailing write (which is the only thing that sets `foldedRecordingIds`) ever ran. An
    // empty array is vacuously a prefix of anything, so without this early return the checks below
    // would seed a full-from-scratch fold (`startIndex: 0`) with that stale content instead of
    // actually starting clean.
    return { startIndex: 0 };
  }
  const isPrefix =
    foldedIds.length <= newIds.length &&
    foldedIds.every((id, index) => id === newIds[index]);
  if (!isPrefix) {
    return { startIndex: 0 };
  }
  return {
    startIndex: foldedIds.length,
    seed: {
      summaryText: existing.summaryText,
      actionItems: existing.actionItems as unknown as ActionItemPayload[],
      decisions: existing.decisions as unknown as string[],
    },
  };
}

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
   * `readyRecordings` is every currently-`READY` recording's id/transcript for this meeting,
   * already ordered by `MeetingRecording.createdAt` (the caller derives it fresh from the database
   * rather than accumulating it across calls) — `FAILED` recordings are excluded by the caller
   * before this is ever invoked.
   *
   * Folding every ready recording from scratch on every call would keep the result correct
   * regardless of completion order, but costs one real agent call per recording *per run* — a
   * meeting with N recordings finishing close together triggers O(N²) agent calls in total, since
   * each new arrival's run re-folds every recording already folded by an earlier run too.
   * `resumeFoldFrom` avoids that in the common case: when `readyRecordings`' ids are an exact,
   * in-order extension of what the persisted `MeetingSummary.foldedRecordingIds` already reflects
   * (recordings finishing in upload order, the usual case), this resumes from that persisted
   * result and only folds the new tail — including the case where nothing changed at all (e.g. a
   * run triggered by nothing but an unrelated recording's `FAILED` transition, see below), which
   * costs zero agent calls. It falls back to a full refold from scratch — the only thing that can
   * still go wrong being a recording that finished out of order (needs folding in earlier than the
   * tail) or the ready set having shrunk (a recording was deleted) — see `resumeFoldFrom`'s own
   * doc comment for the exact rule.
   *
   * `allRecordingsTerminal` tells this run whether every one of the meeting's recordings (`READY`
   * or `FAILED`) has now finished, in which case a successful run settles the summary at `READY`;
   * otherwise it settles back at `PENDING` to await the recording(s) still transcribing. Callers
   * must invoke this on a `FAILED` transition too (not just `READY`), or a meeting whose last
   * recording to finish happens to fail would stay stuck at `PENDING` forever even though its
   * earlier, successfully transcribed recordings already have a summary.
   *
   * When `readyRecordings` is empty (no recording has reached `READY` yet, e.g. every recording so
   * far has failed transcription, or the one recording that had reached `READY` was since deleted),
   * there is nothing to summarize: any existing `MeetingSummary` row is removed — rather than left
   * in place with stale content, or in a processing state — and none is (re)created.
   */
  async generateForMeeting(
    meetingId: string,
    readyRecordings: FoldableRecording[],
    allRecordingsTerminal: boolean,
  ): Promise<void> {
    if (readyRecordings.length === 0) {
      await this.meetingSummaryRepository.deleteIfExists(meetingId);
      return;
    }

    const newIds = readyRecordings.map((recording) => recording.id);
    // Safe to run concurrently: `startProcessing` only ever touches `status`, never
    // `foldedRecordingIds`/`summaryText`/`actionItems`/`decisions` — the fields `resumeFoldFrom`
    // reads from `existing` — so it can't change what this read observes. In the one case where
    // ordering could matter (no row exists yet and `startProcessing` creates one), `existing` may
    // race to see that brand-new placeholder row instead of `null`, but `resumeFoldFrom` treats a
    // row with `summaryText: null` exactly like no row at all, so the outcome is identical either
    // way.
    const [existing, started] = await Promise.all([
      this.meetingSummaryRepository.findByMeetingId(meetingId),
      this.meetingSummaryRepository.startProcessing(meetingId),
    ]);
    if (!started) {
      return;
    }
    const resumePoint = resumeFoldFrom(existing, newIds);

    try {
      let result = resumePoint.seed;
      const toFold = readyRecordings.slice(resumePoint.startIndex);
      if (toFold.length > 0) {
        // Built once and reused across every recording still left to fold in this run, rather
        // than once per `summarize` call — the tool set is identical every time (same `meetingId`),
        // so rebuilding it per recording was pure overhead on top of the real agent calls.
        const meetingToolsServer = await createMeetingToolsServer(
          meetingId,
          this.taskService,
          this,
        );
        for (const recording of toFold) {
          result = await this.summarize(
            meetingId,
            recording.transcriptText,
            result,
            meetingToolsServer,
          );
        }
      }
      if (!result) {
        throw new Error(
          'unreachable: resumeFoldFrom always seeds a startIndex that reaches the end of readyRecordings',
        );
      }

      await this.meetingSummaryRepository.updateStatusIfCurrent(meetingId, {
        status: allRecordingsTerminal
          ? SummaryStatus.READY
          : SummaryStatus.PENDING,
        summaryText: result.summaryText,
        actionItems: result.actionItems as unknown as Prisma.InputJsonValue,
        decisions: result.decisions,
        foldedRecordingIds: newIds,
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
   * If the attempt fails — the agent call itself throws (e.g. a transient SDK/API error), or
   * `parseSummaryReply` rejects a reply that came back (malformed JSON, or a shape `outputFormat`'s
   * schema didn't catch) — this re-asks the agent with the same prompt/options up to
   * `MAX_SUMMARY_ATTEMPTS` times rather than failing on the first bad attempt; Claude occasionally
   * returns a placeholder/truncated `result` instead of the schema-checked `structured_output`, and
   * the underlying SDK call can fail transiently too. A retried attempt re-running
   * `upsert_task`/`update_meeting` is safe to repeat: `upsert_task`'s dedup is scoped to this same
   * `meetingId` (see `meeting-tools.ts`), and `update_meeting` simply overwrites with what should
   * be the same final content. Only the last attempt's error is thrown, once every attempt has
   * failed.
   *
   * `meetingToolsServer` lets a caller folding several recordings in one `generateForMeeting` run
   * (see above) build the `meeting` MCP tool set once and pass it into every `summarize` call
   * instead of this method rebuilding an identical one (same `meetingId`) on every call; omitted,
   * it builds its own — the shape a caller outside the fold loop (or a test) wants.
   *
   * `meetingId` is also passed through to `ClaudeAgentService.ask` purely to tag that run's
   * cost/usage log line — `runClaudeAgent` (`../claude-agent/claude-agent.module.ts`) is what
   * installs the `../hooks` policy hooks (`options.hooks` is not set here) and logs
   * `total_cost_usd`/`usage` once the run's `result` message arrives. `runClaudeAgent` builds a
   * fresh hook set on every call, so the tool-call budget resets on each retry attempt below rather
   * than accumulating across them — each attempt is its own agent run either way (see the retry
   * paragraph above).
   */
  async summarize(
    meetingId: string,
    transcriptText: string,
    previous?: SummaryGenerationResult,
    meetingToolsServer?: Awaited<ReturnType<typeof createMeetingToolsServer>>,
  ): Promise<SummaryGenerationResult> {
    const prompt = buildSummaryPrompt(transcriptText, previous);
    const options: Parameters<ClaudeAgentService['ask']>[1] = {
      model: SUMMARY_MODEL,
      tools: [],
      mcpServers: {
        [MEETING_TOOLS_SERVER_NAME]:
          meetingToolsServer ??
          (await createMeetingToolsServer(meetingId, this.taskService, this)),
      },
      allowedTools: MEETING_ALLOWED_TOOLS,
      systemPrompt: MEETING_AGENT_SYSTEM_PROMPT,
      outputFormat: {
        type: 'json_schema',
        schema: SUMMARY_OUTPUT_JSON_SCHEMA,
      },
    };

    for (let attempt = 1; attempt <= MAX_SUMMARY_ATTEMPTS; attempt++) {
      try {
        const { text, structuredOutput } = await this.claudeAgentService.ask(
          prompt,
          options,
          meetingId,
        );
        const reply =
          structuredOutput !== undefined
            ? JSON.stringify(structuredOutput)
            : text;
        return parseSummaryReply(reply);
      } catch (err) {
        if (attempt === MAX_SUMMARY_ATTEMPTS) {
          throw err;
        }
        this.logger.warn(
          `summarize attempt ${attempt}/${MAX_SUMMARY_ATTEMPTS} for meeting ${meetingId} failed, retrying: ${err instanceof Error ? err.message : String(err)}`,
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
