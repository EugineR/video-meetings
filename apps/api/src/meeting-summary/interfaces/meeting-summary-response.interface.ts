import { MeetingSummary, SummaryStatus } from '@prisma/client';
import { ActionItemPayload } from '../summary-response-parser';

/**
 * `MeetingSummary` with its JSON `actionItems`/`decisions` columns narrowed to their known shape.
 * Both columns are only ever written by `MeetingSummaryRepository` with data produced by
 * `MeetingSummaryService.summarize` (see `parseSummaryReply`), so trusting that shape here is
 * consistent with the rest of the app's "no mapping layer" convention.
 */
export interface MeetingSummaryResponse {
  status: SummaryStatus;
  summaryText: string | null;
  actionItems: ActionItemPayload[];
  decisions: string[];
}

/** `null` when the meeting has no `MeetingSummary` row yet (e.g. no recording has reached `READY` transcription). */
export function toMeetingSummaryResponse(
  summary: MeetingSummary | null,
): MeetingSummaryResponse | null {
  if (!summary) {
    return null;
  }
  return {
    status: summary.status,
    summaryText: summary.summaryText,
    actionItems: summary.actionItems as unknown as ActionItemPayload[],
    decisions: summary.decisions as unknown as string[],
  };
}
