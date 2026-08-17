import { randomUUID } from 'node:crypto';
import { createReadStream, ReadStream } from 'node:fs';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
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
    const dir = join(this.uploadsDir, meetingId);
    await mkdir(dir, { recursive: true });
    const storagePath = join(
      dir,
      `${randomUUID()}${extname(file.originalFilename)}`,
    );
    await writeFile(storagePath, file.buffer);
    return storagePath;
  }

  createReadStream(storagePath: string, range?: StorageByteRange): ReadStream {
    return createReadStream(storagePath, range);
  }

  async delete(storagePath: string): Promise<void> {
    await rm(storagePath, { force: true });
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
