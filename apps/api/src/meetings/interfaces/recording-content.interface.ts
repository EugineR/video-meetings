import { ReadStream } from 'node:fs';
import { StorageByteRange } from '../../storage/storage.service';

/** What `GetRecordingHandler` hands the controller to build the streamed HTTP response. */
export interface RecordingContent {
  stream: ReadStream;
  mimeType: string;
  totalSize: number;
  range: StorageByteRange | null;
}
