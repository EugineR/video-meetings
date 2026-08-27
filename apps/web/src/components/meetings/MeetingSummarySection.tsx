import { Chip, Spinner } from '@heroui/react';
import type { MeetingSummary } from '@/lib/api';

interface MeetingSummarySectionProps {
  summary: MeetingSummary | null;
}

/**
 * Renders the meeting's generated summary, action items and decisions once the summary's status
 * is `READY`, a processing indicator while it's `PENDING`/`PROCESSING` (including while `summary`
 * itself is still `null`, before the background job has created its row), or a failure notice if
 * the summarization run itself errored. The caller decides whether to render this at all — see
 * `MeetingDetailPage`'s `showSummarySection`.
 */
export function MeetingSummarySection({ summary }: MeetingSummarySectionProps) {
  if (summary?.status === 'FAILED') {
    return (
      <p className="text-sm text-danger" role="alert">
        Summary generation failed. No summary is available for this meeting.
      </p>
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
