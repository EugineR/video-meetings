import { Meeting } from '@prisma/client';
import { MeetingWithRecordings } from '../meetings.repository';

/** `Meeting` with its recordings relation collapsed into a `recordingCount` for the list badge. */
export type MeetingListItemResponse = Meeting & { recordingCount: number };

export function toMeetingListItemResponse(
  meeting: MeetingWithRecordings,
): MeetingListItemResponse {
  const { recordings, ...rest } = meeting;
  return { ...rest, recordingCount: recordings.length };
}
