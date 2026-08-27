import { SummaryGenerationResult } from './summary-response-parser';

/**
 * Builds the single-turn prompt sent to Claude for meeting summarization. Asks for a defined JSON
 * shape only (no prose, no markdown fences) so `parseSummaryReply` can deserialize it
 * deterministically instead of scraping free-form text.
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

${previousSection}Read the transcript below and reply with ONLY a single JSON object — no prose, no markdown code fences, nothing before or after it — with exactly these fields:

- "summaryText": a concise prose summary of the meeting (string).
- "actionItems": an array of objects, each with "description" (string, required, free text) and "assignee" (string, include this field only when the transcript names a specific person responsible for that item; omit the field entirely otherwise — never invent a name).
- "decisions": an array of strings, each describing one concrete decision made during the meeting.

If the transcript contains no action items, use an empty array for "actionItems". If it contains no decisions, use an empty array for "decisions". Do not invent information the transcript doesn't support.

Transcript:
"""
${transcriptText}
"""`;
}
