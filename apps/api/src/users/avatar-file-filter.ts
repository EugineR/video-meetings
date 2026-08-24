import { extname } from 'node:path';

const MIME_TYPE_EXTENSIONS: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
};

export function parseAllowedMimeTypes(raw: string): string[] {
  return raw
    .split(',')
    .map((mimeType) => mimeType.trim())
    .filter(Boolean);
}

/**
 * Throws if `allowedMimeTypes` (parsed from the `ALLOWED_AVATAR_MIME_TYPES`
 * env var) contains a MIME type this module has no extension mapping for —
 * otherwise `isAllowedAvatarFile` would silently 415 every upload of that
 * type no matter what the operator configured. Meant to be called once at
 * app bootstrap so a misconfiguration fails loudly instead of per-request.
 */
export function assertKnownAvatarMimeTypes(allowedMimeTypes: string[]): void {
  const unknown = allowedMimeTypes.filter(
    (mimeType) => !(mimeType in MIME_TYPE_EXTENSIONS),
  );
  if (unknown.length > 0) {
    throw new Error(
      `ALLOWED_AVATAR_MIME_TYPES contains MIME type(s) with no known file extension mapping in avatar-file-filter.ts: ${unknown.join(', ')}`,
    );
  }
}

export function isAllowedAvatarFile(
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
