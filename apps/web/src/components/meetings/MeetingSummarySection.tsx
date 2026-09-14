'use client';

import { Spinner } from '@heroui/react';
import type { MeetingSummary } from '@/lib/api';
import { getInitials } from '@/lib/format';
import { CheckIcon } from '@/components/icons';
import { AVATAR_TINTS } from '@/components/meetings/ParticipantAvatars';
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
 * `useMeetingSummaryStatus`'s `showSummarySection`; the caller also owns the panel's heading and
 * "AI READY" badge (`/meetings/[id]`'s page), since neither depends on this component's props.
 *
 * Action-item assignees render as a mini initials avatar (design's `fdLci`), tinted the same
 * deterministic way as `ParticipantAvatars` — by position in the list, through the shared
 * `AVATAR_TINTS` — rather than a per-name color lookup that would need a new data source.
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
      <div className="flex items-center gap-2 text-[11px] text-muted lg:text-xs">
        <Spinner aria-label="Generating summary" size="sm" />
        Generating summary…
      </div>
    );
  }

  const { summaryText, actionItems, decisions } = summary;

  return (
    <div className="flex flex-col gap-[15px] lg:gap-[18px]">
      {isUpdating ? (
        <div className="flex items-center gap-2 text-[11px] text-muted lg:text-xs">
          <Spinner aria-label="Updating summary" size="sm" />
          Updating — more recordings are still being processed…
        </div>
      ) : null}

      {summaryText ? (
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[8px] font-semibold tracking-[0.8px] text-muted lg:text-[9px] lg:tracking-[0.9px]">
            SUMMARY
          </p>
          <p className="text-[11px] leading-[1.5] whitespace-pre-wrap text-foreground lg:text-[13px] lg:leading-[1.55]">
            {summaryText}
          </p>
        </div>
      ) : null}

      <div className="h-px w-full bg-border" />

      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-head text-[13px] font-semibold text-foreground lg:text-sm">
            Action items
          </h3>
          {actionItems.length > 0 ? (
            <p className="shrink-0 font-mono text-[8px] font-semibold tracking-[0.6px] text-muted lg:text-[9px]">
              {actionItems.length} {actionItems.length === 1 ? 'ITEM' : 'ITEMS'}
            </p>
          ) : null}
        </div>
        {actionItems.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {actionItems.map((item, index) => (
              <li
                className="flex min-h-12 items-center gap-2 rounded-lg bg-subtle px-3 py-2 lg:gap-2.5"
                key={index}
              >
                <span
                  aria-hidden="true"
                  className="size-[18px] shrink-0 rounded-[5px] border border-border"
                />
                <span className="min-w-0 flex-1 text-[11px] font-medium break-words text-foreground">
                  {item.description}
                </span>
                {item.assignee ? (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span
                      className={`flex size-6 shrink-0 items-center justify-center rounded-full font-head text-[9px] font-semibold ${AVATAR_TINTS[index % AVATAR_TINTS.length]}`}
                    >
                      {getInitials(item.assignee, item.assignee)}
                    </span>
                    <span className="text-[10px] font-semibold text-muted">
                      {item.assignee}
                    </span>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-muted lg:text-xs">
            No action items identified.
          </p>
        )}
      </div>

      <div className="h-px w-full bg-border" />

      <div className="flex flex-col gap-2.5">
        <h3 className="font-head text-[13px] font-semibold text-foreground lg:text-sm">
          Decisions
        </h3>
        {decisions.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {decisions.map((decision, index) => (
              <li className="flex items-start gap-2.5" key={index}>
                <span className="flex size-6 shrink-0 items-center justify-center rounded-[7px] bg-success-soft text-success">
                  <CheckIcon aria-hidden="true" className="size-[13px]" />
                </span>
                <span className="text-[11px] leading-[1.45] text-foreground">
                  {decision}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-muted lg:text-xs">
            No decisions recorded.
          </p>
        )}
      </div>
    </div>
  );
}
