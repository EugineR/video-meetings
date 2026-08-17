'use client';

import { useRef, useState } from 'react';
import { Button, Label, ProgressBar } from '@heroui/react';
import {
  ApiError,
  type Recording,
  UploadCancelledError,
  uploadMeetingRecording,
} from '@/lib/api';
import { UploadIcon, XMarkIcon } from '@/components/icons';

/**
 * Mirrors apps/api/.env's ALLOWED_RECORDING_MIME_TYPES / MAX_UPLOAD_SIZE_BYTES
 * defaults. This is a client-side UX check only — the API enforces the real
 * limits and is the source of truth (see docs/prd-meeting-recording-upload.md).
 */
const ALLOWED_MIME_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const ALLOWED_EXTENSIONS_LABEL = 'MP4, WebM, MOV';
const MAX_SIZE_BYTES = 500 * 1024 * 1024;
const MAX_SIZE_LABEL = '500 MB';

function validateFile(file: File): string | null {
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return `Unsupported file type. Allowed types: ${ALLOWED_EXTENSIONS_LABEL}.`;
  }
  if (file.size > MAX_SIZE_BYTES) {
    return `File is too large. Maximum size is ${MAX_SIZE_LABEL}.`;
  }
  return null;
}

interface RecordingUploaderProps {
  meetingId: string;
  onUploaded: (recording: Recording) => void;
}

export function RecordingUploader({
  meetingId,
  onUploaded,
}: RecordingUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const startUpload = (file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setProgress(0);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    uploadMeetingRecording(meetingId, file, {
      onProgress: setProgress,
      signal: controller.signal,
    })
      .then((recording) => {
        setProgress(null);
        onUploaded(recording);
      })
      .catch((err: unknown) => {
        setProgress(null);
        if (err instanceof UploadCancelledError) {
          return;
        }
        setError(
          err instanceof ApiError
            ? err.message
            : 'Upload failed. Please try again.',
        );
      });
  };

  const isUploading = progress !== null;

  const handleFileInputChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    // Guards against a second file slipping in (e.g. a fast repeat pick)
    // while the first upload's request is still in flight.
    if (file && !isUploading) {
      startUpload(file);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (isUploading) {
      return;
    }
    const file = event.dataTransfer.files?.[0];
    if (file) {
      startUpload(file);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        className={`flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
          isDragging
            ? 'border-accent bg-accent/10'
            : 'border-default-200 bg-default-50'
        }`}
        onDragLeave={() => setIsDragging(false)}
        onDragOver={(event) => {
          event.preventDefault();
          if (!isUploading) {
            setIsDragging(true);
          }
        }}
        onDrop={handleDrop}
      >
        <UploadIcon aria-hidden="true" className="size-8 text-muted" />

        {isUploading ? (
          <div className="flex w-full max-w-xs flex-col gap-2">
            <ProgressBar aria-label="Upload progress" value={progress}>
              <Label>Uploading…</Label>
              <ProgressBar.Output />
              <ProgressBar.Track>
                <ProgressBar.Fill />
              </ProgressBar.Track>
            </ProgressBar>
            <Button
              className="h-11 self-center md:h-10"
              onPress={() => abortControllerRef.current?.abort()}
              size="sm"
              variant="secondary"
            >
              <XMarkIcon className="size-4" />
              Cancel
            </Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted">
              Drag and drop a recording here, or
            </p>
            <Button
              className="h-11 md:h-10"
              onPress={() => inputRef.current?.click()}
              variant="secondary"
            >
              Choose file
            </Button>
            <p className="text-xs text-muted">
              {ALLOWED_EXTENSIONS_LABEL} · up to {MAX_SIZE_LABEL}
            </p>
          </>
        )}

        <input
          accept={ALLOWED_MIME_TYPES.join(',')}
          className="hidden"
          disabled={isUploading}
          onChange={handleFileInputChange}
          ref={inputRef}
          type="file"
        />
      </div>

      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
