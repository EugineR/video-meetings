import { extname } from 'node:path';

const MIME_TYPE_EXTENSIONS: Record<string, string[]> = {
  'video/mp4': ['.mp4'],
  'video/webm': ['.webm'],
  'video/quicktime': ['.mov'],
};

export function parseAllowedMimeTypes(raw: string): string[] {
  return raw
    .split(',')
    .map((mimeType) => mimeType.trim())
    .filter(Boolean);
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
