import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

describe('StorageService', () => {
  let uploadsDir: string;
  let service: StorageService;

  beforeEach(() => {
    uploadsDir = join(tmpdir(), `storage-service-test-${randomUUID()}`);
    const config = {
      getOrThrow: () => uploadsDir,
    } as unknown as ConfigService;
    service = new StorageService(config);
  });

  afterEach(() => {
    rmSync(uploadsDir, { recursive: true, force: true });
  });

  it('saves a file under {UPLOADS_DIR}/{meetingId}/{uuid}{ext}', async () => {
    const meetingId = randomUUID();
    const buffer = Buffer.from('hello recording');

    const storagePath = await service.save(meetingId, {
      originalFilename: 'my-recording.mp4',
      buffer,
    });

    expect(storagePath.startsWith(join(uploadsDir, meetingId))).toBe(true);
    expect(storagePath.endsWith('.mp4')).toBe(true);
    expect(existsSync(storagePath)).toBe(true);

    const filesInMeetingDir = await readdir(join(uploadsDir, meetingId));
    expect(filesInMeetingDir).toHaveLength(1);
  });

  it('stream-reads back the exact bytes that were saved', async () => {
    const buffer = Buffer.from('stream me');
    const storagePath = await service.save(randomUUID(), {
      originalFilename: 'clip.webm',
      buffer,
    });

    const chunks: Buffer[] = [];
    await new Promise<void>((resolvePromise, reject) => {
      const stream = service.createReadStream(storagePath);
      stream.on('data', (chunk) => chunks.push(chunk as Buffer));
      stream.on('end', () => resolvePromise());
      stream.on('error', reject);
    });

    expect(Buffer.concat(chunks).toString()).toBe('stream me');
  });

  it('exists() reflects whether the file is on disk, and delete() removes it', async () => {
    const storagePath = await service.save(randomUUID(), {
      originalFilename: 'clip.mp4',
      buffer: Buffer.from('data'),
    });

    await expect(service.exists(storagePath)).resolves.toBe(true);

    await service.delete(storagePath);

    await expect(service.exists(storagePath)).resolves.toBe(false);
  });

  it('delete() also removes the now-empty {meetingId} directory', async () => {
    const storagePath = await service.save(randomUUID(), {
      originalFilename: 'clip.mp4',
      buffer: Buffer.from('data'),
    });

    await service.delete(storagePath);

    expect(existsSync(dirname(storagePath))).toBe(false);
  });

  it('delete() leaves a sibling recording untouched when the meeting directory is not empty', async () => {
    const meetingId = randomUUID();
    const storagePathA = await service.save(meetingId, {
      originalFilename: 'a.mp4',
      buffer: Buffer.from('a'),
    });
    const storagePathB = await service.save(meetingId, {
      originalFilename: 'b.mp4',
      buffer: Buffer.from('b'),
    });

    await service.delete(storagePathA);

    expect(existsSync(dirname(storagePathA))).toBe(true);
    await expect(service.exists(storagePathB)).resolves.toBe(true);
  });

  it('exists() returns false for a path that was never written', async () => {
    await expect(
      service.exists(join(uploadsDir, 'nowhere', 'ghost.mp4')),
    ).resolves.toBe(false);
  });
});
