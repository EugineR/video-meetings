import { Meeting, MeetingSummary } from '@prisma/client';
import {
  MeetingSummaryResponse,
  toMeetingSummaryResponse,
} from '../../meeting-summary/interfaces/meeting-summary-response.interface';
import { MeetingWithRecordings } from '../meetings.repository';
import {
  RecordingResponse,
  toRecordingResponse,
} from './recording-response.interface';

/**
 * `Meeting` with its recordings relation flattened into a `recordings` field (metadata for every
 * file uploaded to the meeting) and a `summary` field — `null` when the meeting has no
 * `MeetingSummary` row yet (e.g. no recording has reached `READY` transcription).
 */
export type MeetingDetailResponse = Meeting & {
  recordings: RecordingResponse[];
  summary: MeetingSummaryResponse | null;
};

export function toMeetingDetailResponse(
  meeting: MeetingWithRecordings,
  summary: MeetingSummary | null,
): MeetingDetailResponse {
  const { recordings, ...rest } = meeting;
  return {
    ...rest,
    recordings: recordings.map(toRecordingResponse),
    summary: toMeetingSummaryResponse(summary),
  };
}
