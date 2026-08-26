import { Meeting } from '@prisma/client';
import { MeetingWithRecordings } from '../meetings.repository';
import {
  RecordingResponse,
  toRecordingResponse,
} from './recording-response.interface';

/** `Meeting` with its recordings relation flattened into a `recordings` field (metadata for every file uploaded to the meeting). */
export type MeetingDetailResponse = Meeting & {
  recordings: RecordingResponse[];
};

export function toMeetingDetailResponse(
  meeting: MeetingWithRecordings,
): MeetingDetailResponse {
  const { recordings, ...rest } = meeting;
  return {
    ...rest,
    recordings: recordings.map(toRecordingResponse),
  };
}
