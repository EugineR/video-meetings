/**
 * The client-side mirror of the API's upload allowlists and size caps.
 *
 * These are a UX check only — `apps/api` enforces the real limits and is the
 * source of truth (see `docs/meeting-recording-upload/prd.md`). Both entries
 * below must stay in sync with `apps/api/.env`: `RECORDING_UPLOAD` with
 * `ALLOWED_RECORDING_MIME_TYPES` / `MAX_UPLOAD_SIZE_BYTES`, `AVATAR_UPLOAD`
 * with `ALLOWED_AVATAR_MIME_TYPES` / `MAX_AVATAR_SIZE_BYTES`. Change one,
 * change the other, or the browser accepts a file the API then rejects.
 */
export interface UploadConstraints {
  /** MIME types the file picker accepts and the client-side check allows. */
  allowedMimeTypes: readonly string[];
  /** Human-readable extension list, shown in the hint and the rejection message. */
  allowedExtensionsLabel: string;
  maxSizeBytes: number;
  /** Human-readable size cap, shown in the hint and the rejection message. */
  maxSizeLabel: string;
}

export const RECORDING_UPLOAD: UploadConstraints = {
  allowedMimeTypes: [
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'audio/mpeg',
  ],
  allowedExtensionsLabel: 'MP4, WebM, MOV, MP3',
  maxSizeBytes: 500 * 1024 * 1024,
  maxSizeLabel: '500 MB',
};

export const AVATAR_UPLOAD: UploadConstraints = {
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  allowedExtensionsLabel: 'JPEG, PNG, WebP',
  maxSizeBytes: 5 * 1024 * 1024,
  maxSizeLabel: '5 MB',
};

/**
 * The one client-side file check, shared by every uploader through
 * `useFileSelection`. Returns the message to show, or `null` when the file
 * passes. The wording is deliberately identical for recordings and avatars —
 * only the constraints differ.
 */
export function validateFile(
  file: File,
  constraints: UploadConstraints,
): string | null {
  if (!constraints.allowedMimeTypes.includes(file.type)) {
    return `Unsupported file type. Allowed types: ${constraints.allowedExtensionsLabel}.`;
  }
  if (file.size > constraints.maxSizeBytes) {
    return `File is too large. Maximum size is ${constraints.maxSizeLabel}.`;
  }
  return null;
}
