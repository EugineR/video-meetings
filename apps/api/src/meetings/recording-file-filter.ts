import { extname } from 'node:path';

const MIME_TYPE_EXTENSIONS: Record<string, string[]> = {
  'video/mp4': ['.mp4'],
  'video/webm': ['.webm'],
  'video/quicktime': ['.mov'],
  'audio/mpeg': ['.mp3'],
};

export function parseAllowedMimeTypes(raw: string): string[] {
  return raw
    .split(',')
    .map((mimeType) => mimeType.trim())
    .filter(Boolean);
}

/**
 * Throws if `allowedMimeTypes` (parsed from the `ALLOWED_RECORDING_MIME_TYPES`
 * env var) contains a MIME type this module has no extension mapping for —
 * otherwise `isAllowedRecordingFile` would silently 415 every upload of that
 * type no matter what the operator configured. Meant to be called once at
 * app bootstrap so a misconfiguration fails loudly instead of per-request.
 */
export function assertKnownRecordingMimeTypes(
  allowedMimeTypes: string[],
): void {
  const unknown = allowedMimeTypes.filter(
    (mimeType) => !(mimeType in MIME_TYPE_EXTENSIONS),
  );
  if (unknown.length > 0) {
    throw new Error(
      `ALLOWED_RECORDING_MIME_TYPES contains MIME type(s) with no known file extension mapping in recording-file-filter.ts: ${unknown.join(', ')}`,
    );
  }
}

export function isAllowedRecordingFile(
  mimetype: string,
  originalFilename: string,
  allowedMimeTypes: string[],
): boolean {
  if (!allowedMimeTypes.includes(mimetype)) {
    return false;
  }

  const allowedExtensions = MIME_TYPE_EXTENSIONS[mimetype];
  if (!allowedExtensions) {
    return false;
  }

  return allowedExtensions.includes(extname(originalFilename).toLowerCase());
}
