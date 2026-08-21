import { ReadStream } from 'node:fs';

/** What `GetAvatarHandler` hands the controller to build the streamed HTTP response. */
export interface AvatarContent {
  stream: ReadStream;
  mimeType: string;
  sizeBytes: number;
}
