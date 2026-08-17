import { MeetingRecording } from '@prisma/client';

/** `MeetingRecording` with `sizeBytes` serialized to a JSON-safe string (raw `BigInt` throws in `res.json()`). */
export type RecordingResponse = Omit<MeetingRecording, 'sizeBytes'> & {
  sizeBytes: string;
};

export function toRecordingResponse(
  recording: MeetingRecording,
): RecordingResponse {
  return { ...recording, sizeBytes: recording.sizeBytes.toString() };
}
