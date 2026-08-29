'use client';

import { useState } from 'react';
import { Button, Label, ProgressBar } from '@heroui/react';
import { type Recording, uploadMeetingRecording } from '@/lib/api';
import { RECORDING_UPLOAD } from '@/lib/uploads';
import { useFileSelection } from '@/lib/useFileSelection';
import { UploadIcon, XMarkIcon } from '@/components/icons';
import { ErrorText } from '@/components/ui/ErrorText';

interface RecordingUploaderProps {
  meetingId: string;
  onUploaded: (recording: Recording) => void;
}

/**
 * The drop zone: drag-and-drop or "Choose file", then an immediate upload with
 * a progress bar and a "Cancel" control. Everything below the drag handling —
 * the hidden input, the client-side check, progress, the mid-upload guard and
 * cancellation — comes from `useFileSelection`.
 */
export function RecordingUploader({
  meetingId,
  onUploaded,
}: RecordingUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const selection = useFileSelection({
    constraints: RECORDING_UPLOAD,
    mode: 'immediate',
    upload: (file, options) => uploadMeetingRecording(meetingId, file, options),
    onUploaded,
  });
  const { isUploading, progress } = selection;

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      selection.selectFile(file);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        className={`flex h-64 flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 text-center transition-colors ${
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

        {progress !== null ? (
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
              onPress={selection.cancelUpload}
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
              onPress={selection.openFilePicker}
              variant="secondary"
            >
              Choose file
            </Button>
            <p className="text-xs text-muted">
              {RECORDING_UPLOAD.allowedExtensionsLabel} · up to{' '}
              {RECORDING_UPLOAD.maxSizeLabel}
            </p>
          </>
        )}

        <input {...selection.inputProps} />
      </div>

      {selection.error ? <ErrorText>{selection.error}</ErrorText> : null}
    </div>
  );
}
