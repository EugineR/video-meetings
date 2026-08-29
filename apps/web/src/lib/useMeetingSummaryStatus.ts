'use client';

import { useCallback, useState } from 'react';
import type { MeetingDetail } from '@/lib/api';
import {
  hasSummarySection,
  isMeetingSettled,
  recordingsSignature,
} from '@/lib/meetings';

export interface MeetingSummaryStatus {
  /** True while the shown summary may not cover the meeting's current recordings. */
  isSummaryPending: boolean;
  /** Whether the "Summary" card is worth rendering at all. */
  showSummarySection: boolean;
  /**
   * Forgets which set of recordings the summary was last known to cover, so the next
   * render re-derives `isSummaryPending` from scratch. Call it after deleting a recording,
   * together with removing that recording from the meeting this hook is given — see below.
   */
  resetReconciliation: () => void;
}

/**
 * Tracks whether a meeting's summary has caught up with its recordings.
 *
 * It keeps the fingerprint (`recordingsSignature`) of the recording set the summary was
 * last seen to cover, and advances it only once the meeting is settled — every recording
 * terminal and the summary caught up with them (`isMeetingSettled`, which is where the
 * `foldedRecordingIds` reasoning lives). Anything the fingerprint doesn't cover yet is
 * "pending": the summary on screen is real data, but not necessarily the final one.
 *
 * The fingerprint is updated conditionally during render — React's documented pattern for
 * deriving state from changed input without the extra render+commit round-trip a
 * `useEffect` would add (see "Adjusting state when a prop changes" in the React docs) —
 * rather than in an effect.
 *
 * `resetReconciliation` exists for deletion: a deleted recording can leave the cached
 * summary stale relative to the new recording set — e.g. it was `READY` based partly on
 * the recording just removed — without that being visible from the leftover recordings'
 * own statuses alone (deleting the meeting's only recording leaves an empty, vacuously
 * "all terminal" list). Clearing the fingerprint there, rather than leaving whatever it
 * last matched, drops the claim that the summary covered anything, so the summary is
 * re-measured against the post-deletion recordings instead of the page trusting a
 * verdict it can no longer vouch for.
 *
 * The reset only holds if the caller also removes the recording from the `meeting` passed
 * in (`useMeetingDetailQuery`'s `onRecordingDeleted` writes the cache before invalidating).
 * Clearing the fingerprint while still being handed the pre-deletion recordings would
 * simply re-advance it on the next render — the meeting is, after all, still settled by
 * its own stale data.
 */
export function useMeetingSummaryStatus(
  meeting: MeetingDetail | null,
): MeetingSummaryStatus {
  const [reconciledRecordingsSignature, setReconciledRecordingsSignature] =
    useState<string | null>(null);

  const signature = meeting ? recordingsSignature(meeting) : null;
  if (
    meeting &&
    signature !== reconciledRecordingsSignature &&
    isMeetingSettled(meeting)
  ) {
    setReconciledRecordingsSignature(signature);
  }

  const resetReconciliation = useCallback(() => {
    setReconciledRecordingsSignature(null);
  }, []);

  return {
    isSummaryPending:
      meeting !== null && signature !== reconciledRecordingsSignature,
    showSummarySection: meeting !== null && hasSummarySection(meeting),
    resetReconciliation,
  };
}
