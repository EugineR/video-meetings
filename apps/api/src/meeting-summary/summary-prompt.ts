import { SummaryGenerationResult } from './summary-response-parser';

/**
 * Builds the prompt sent to Claude for meeting summarization. Deliberately does not tell the
 * model to answer with "only JSON, nothing else" or otherwise imply a single-turn reply: the
 * agent is expected to first call the `meeting` MCP tools (`find_tasks`/`upsert_task` per
 * `MEETING_AGENT_SYSTEM_PROMPT`, then `update_meeting`) and only then submit its final answer —
 * `options.outputFormat` (see `MeetingSummaryService.summarize`) is what enforces the JSON shape
 * on that final answer via the SDK's own structured-output mechanism, so nothing here needs to.
 * An earlier version of this prompt *did* say "reply with ONLY a single JSON object ... nothing
 * before or after it", left over from before the `meeting` tools existed — that line made the
 * model skip straight to a direct JSON answer without ever calling a tool, silently defeating the
 * whole find_tasks/upsert_task/update_meeting flow (confirmed by comparing tool-call traces with
 * and without that line — same prompt otherwise, same model). Do not reintroduce it or any
 * equivalent "just answer now" phrasing.
 *
 * Deliberately does not mention which meeting this is — the `meeting` MCP tools
 * (`upsert_task`/`update_meeting`) take no meeting id as input; `createMeetingToolsServer` binds
 * the actual meeting id itself (see `MeetingSummaryService.summarize`), so the model has no way to
 * redirect a tool call to a different meeting even if the transcript tries to instruct it to.
 *
 * When `previous` is given (a meeting with more than one recording, folding in a later one), the
 * prompt includes the summary/action items/decisions already generated from earlier recordings of
 * the same meeting and instructs the model to extend and de-duplicate against it rather than
 * restart from scratch — the new transcript is additional material about the same meeting, not an
 * unrelated one.
 */
export function buildSummaryPrompt(
  transcriptText: string,
  previous?: SummaryGenerationResult,
): string {
  const previousSection = previous
    ? `This meeting has more than one recording. Below is the summary already generated from the meeting's earlier recording(s), followed by a transcript of another recording of the SAME meeting (e.g. a continuation after a break, or a separate segment recorded alongside it) that has not been incorporated yet.

Previous summary so far:
"""
${previous.summaryText}
"""

Previous action items so far (JSON):
${JSON.stringify(previous.actionItems)}

Previous decisions so far (JSON):
${JSON.stringify(previous.decisions)}

Produce an UPDATED summary/action items/decisions for the meeting as a whole: extend the previous result with anything new the transcript below adds, keep everything from the previous result that still holds, and merge or drop anything the new transcript merely repeats — the same action item or decision must never appear twice. Do not restart from scratch and do not discard previous content that the new transcript doesn't contradict.

`
    : '';

  return `You are generating a meeting summary from a transcript for a note-taking application.

${previousSection}Read the transcript below. First, use the meeting tools available to you to record any action items as tasks and to write the meeting's summary and decisions, following the rules in your instructions. Once you've done that, submit your final answer with exactly these fields:

- "summaryText": a concise prose summary of the meeting (string).
- "actionItems": an array of objects, each with "description" (string, required, free text) and "assignee" (string, include this field only when the transcript names a specific person responsible for that item; omit the field entirely otherwise — never invent a name).
- "decisions": an array of strings, each describing one concrete decision made during the meeting.

If the transcript contains no action items, use an empty array for "actionItems". If it contains no decisions, use an empty array for "decisions". Do not invent information the transcript doesn't support.

Transcript:
"""
${transcriptText}
"""`;
}
