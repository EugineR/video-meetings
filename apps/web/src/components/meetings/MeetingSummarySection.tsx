'use client';

import { Chip, Spinner } from '@heroui/react';
import type { MeetingSummary } from '@/lib/api';
import { ErrorText } from '@/components/ui/ErrorText';

interface MeetingSummarySectionProps {
  /**
   * True while the summary hasn't caught up with the meeting's current recordings yet (see
   * `useMeetingSummaryStatus`'s `isSummaryPending`) — including the case where `summary.status`
   * already reads `READY`: the API's `update_meeting` agent tool can briefly settle it to `READY`
   * mid-fold, before the real, final result (and possibly more recordings) has been folded in.
   * Shown as an inline "still updating" notice above the (possibly not-yet-final) content, rather
   * than hiding it behind the full processing spinner, since there is real content to show in the
   * meantime.
   */
  isUpdating: boolean;
  summary: MeetingSummary | null;
}

/**
 * Renders the meeting's generated summary, action items and decisions once the summary's status
 * is `READY`, a processing indicator while it's `PENDING`/`PROCESSING` (including while `summary`
 * itself is still `null`, before the background job has created its row), or a failure notice if
 * the summarization run itself errored. The caller decides whether to render this at all — see
 * `useMeetingSummaryStatus`'s `showSummarySection`.
 */
export function MeetingSummarySection({
  isUpdating,
  summary,
}: MeetingSummarySectionProps) {
  if (summary?.status === 'FAILED') {
    return (
      <ErrorText>
        Summary generation failed. No summary is available for this meeting.
      </ErrorText>
    );
  }

  if (summary?.status !== 'READY') {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-muted">
        <Spinner aria-label="Generating summary" size="sm" />
        Generating summary…
      </div>
    );
  }

  const { summaryText, actionItems, decisions } = summary;

  return (
    <div className="flex flex-col gap-6">
      {isUpdating ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner aria-label="Updating summary" size="sm" />
          Updating — more recordings are still being processed…
        </div>
      ) : null}

      {summaryText ? (
        <p className="text-sm whitespace-pre-wrap text-muted">{summaryText}</p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">Action items</p>
        {actionItems.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {actionItems.map((item, index) => (
              <li
                className="flex flex-wrap items-center gap-2 text-sm"
                key={index}
              >
                <span>{item.description}</span>
                {item.assignee ? (
                  <Chip color="accent" size="sm" variant="soft">
                    <Chip.Label>{item.assignee}</Chip.Label>
                  </Chip>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No action items identified.</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">Decisions</p>
        {decisions.length > 0 ? (
          <ul className="flex flex-col gap-1 pl-5 text-sm text-muted [&>li]:list-disc">
            {decisions.map((decision, index) => (
              <li key={index}>{decision}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No decisions recorded.</p>
        )}
      </div>
    </div>
  );
}
