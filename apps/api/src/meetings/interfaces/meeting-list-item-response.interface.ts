import { Meeting } from '@prisma/client';
import { MeetingWithRecording } from '../meetings.repository';

/** `Meeting` with its recording relation collapsed into a `hasRecording` boolean for the list badge. */
export type MeetingListItemResponse = Meeting & { hasRecording: boolean };

export function toMeetingListItemResponse(
  meeting: MeetingWithRecording,
): MeetingListItemResponse {
  const { recording, ...rest } = meeting;
  return { ...rest, hasRecording: recording !== null };
}
