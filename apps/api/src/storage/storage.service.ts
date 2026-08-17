import { randomUUID } from 'node:crypto';
import { createReadStream, ReadStream } from 'node:fs';
import { access, mkdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface StorageFileInput {
  originalFilename: string;
  buffer: Buffer;
}

export interface StorageByteRange {
  start: number;
  end: number;
}

@Injectable()
export class StorageService {
  private readonly uploadsDir: string;

  constructor(config: ConfigService) {
    this.uploadsDir = resolve(config.getOrThrow<string>('UPLOADS_DIR'));
  }

  async save(meetingId: string, file: StorageFileInput): Promise<string> {
    const dir = this.resolveMeetingDir(meetingId);
    await mkdir(dir, { recursive: true });
    const storagePath = join(dir, this.generateFilename(file.originalFilename));
    await writeFile(storagePath, file.buffer);
    return storagePath;
  }

  /** The `{UPLOADS_DIR}/{meetingId}` directory a recording for this meeting is stored under. */
  resolveMeetingDir(meetingId: string): string {
    return join(this.uploadsDir, meetingId);
  }

  /** A fresh `{uuid}{ext}` filename, extension derived from the given original filename. */
  generateFilename(originalFilename: string): string {
    return `${randomUUID()}${extname(originalFilename)}`;
  }

  createReadStream(storagePath: string, range?: StorageByteRange): ReadStream {
    return createReadStream(storagePath, range);
  }

  async delete(storagePath: string): Promise<void> {
    await rm(storagePath, { force: true });

    try {
      await rmdir(dirname(storagePath));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOTEMPTY' && code !== 'ENOENT') {
        throw err;
      }
    }
  }

  async exists(storagePath: string): Promise<boolean> {
    try {
      await access(storagePath);
      return true;
    } catch {
      return false;
    }
  }
}
