import { mkdir } from 'node:fs/promises';
import { UnsupportedMediaTypeException } from '@nestjs/common';
import type { Request } from 'express';
import { diskStorage, StorageEngine } from 'multer';
import { StorageService } from './storage.service';

export interface UploadMulterOptionsConfig {
  storageService: StorageService;
  /** Resolves the destination directory for a given request — the only thing that differs between an upload keyed by a URL param (a recording's meetingId) and one keyed by the authenticated caller (an avatar's userId). */
  resolveDir: (req: Request) => string;
  maxFileSizeBytes: number;
  allowedMimeTypes: string[];
  isAllowedFile: (
    mimetype: string,
    originalFilename: string,
    allowedMimeTypes: string[],
  ) => boolean;
  unsupportedMediaTypeMessage: (mimetype: string) => string;
}

export interface UploadMulterOptions {
  storage: StorageEngine;
  limits: { fileSize: number };
  fileFilter: (
    req: Request,
    file: Express.Multer.File,
    cb: (error: Error | null, acceptFile: boolean) => void,
  ) => void;
}

/**
 * Shared `MulterModule.registerAsync` factory body for both the meeting-recording
 * and avatar upload routes: writes to a `StorageService`-resolved directory under a
 * fresh `StorageService.generateFilename` name, enforces `maxFileSizeBytes`, and
 * rejects (415) via `isAllowedFile` — the only per-route pieces are how the
 * destination directory and the allowlist are derived.
 */
export function createUploadMulterOptions(
  config: UploadMulterOptionsConfig,
): UploadMulterOptions {
  return {
    storage: diskStorage({
      destination: (req, _file, cb) => {
        let dir: string;
        try {
          dir = config.resolveDir(req);
        } catch (err) {
          return cb(err as Error, '');
        }
        void mkdir(dir, { recursive: true })
          .then(() => cb(null, dir))
          .catch((err: unknown) => cb(err as Error, dir));
      },
      filename: (_req, file, cb) => {
        cb(null, config.storageService.generateFilename(file.originalname));
      },
    }),
    limits: {
      fileSize: config.maxFileSizeBytes,
    },
    fileFilter: (_req, file, cb) => {
      if (
        !config.isAllowedFile(
          file.mimetype,
          file.originalname,
          config.allowedMimeTypes,
        )
      ) {
        return cb(
          new UnsupportedMediaTypeException(
            config.unsupportedMediaTypeMessage(file.mimetype),
          ),
          false,
        );
      }
      cb(null, true);
    },
  };
}
