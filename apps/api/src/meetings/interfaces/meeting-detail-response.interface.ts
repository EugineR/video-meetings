import { Meeting } from '@prisma/client';
import { MeetingWithRecording } from '../meetings.repository';
import {
  RecordingResponse,
  toRecordingResponse,
} from './recording-response.interface';

/** `Meeting` with its recording relation flattened into a `recording` field (metadata, or `null` when there is none). */
export type MeetingDetailResponse = Meeting & {
  recording: RecordingResponse | null;
};

export function toMeetingDetailResponse(
  meeting: MeetingWithRecording,
): MeetingDetailResponse {
  const { recording, ...rest } = meeting;
  return {
    ...rest,
    recording: recording ? toRecordingResponse(recording) : null,
  };
}
