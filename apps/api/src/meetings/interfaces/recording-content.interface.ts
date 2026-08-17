import { ReadStream } from 'node:fs';
import { ByteRange } from '../range-parser';

/** What `GetRecordingHandler` hands the controller to build the streamed HTTP response. */
export interface RecordingContent {
  stream: ReadStream;
  mimeType: string;
  totalSize: number;
  range: ByteRange | null;
}
