'use client';

import { useState } from 'react';
import { Label, ProgressBar } from '@heroui/react';
import { type Recording, uploadMeetingRecording } from '@/lib/api';
import { RECORDING_UPLOAD } from '@/lib/uploads';
import { useFileSelection } from '@/lib/useFileSelection';
import { FolderOpenIcon, UploadCloudIcon, XMarkIcon } from '@/components/icons';
import { Button } from '@/components/ui/Button';
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
 *
 * The idle state matches the design's "Recording Upload Zone" (`Mn57N`): a solid
 * (not dashed) bordered box, an accent-tinted icon circle, a heading over a single
 * helper line combining the "or choose a file" prompt with the constraints, and a
 * primary "Choose file" button — replacing the earlier plain dashed box. The button
 * stays an unstyled `<Button>` so it always tracks the shared Button/Primary design
 * token rather than baking in a one-off color. Sizes step down slightly below `lg`,
 * matching the design's mobile stack (`WuOMR`), short of the touch-target minimum
 * `src/lib/touchTarget.ts` enforces on every control.
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
        className={`flex h-56 flex-col items-center justify-center gap-2.5 rounded-[9px] border px-4 text-center transition-colors lg:h-64 lg:px-5 ${
          isDragging ? 'border-accent bg-accent/10' : 'border-border bg-subtle'
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
              className="self-center"
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
            <span className="flex size-9 items-center justify-center rounded-[10px] bg-accent-soft lg:size-10">
              <UploadCloudIcon
                aria-hidden="true"
                className="size-4 text-accent lg:size-[19px]"
              />
            </span>
            <p className="font-head text-[13px] font-semibold text-foreground lg:text-[15px]">
              Drop a recording here
            </p>
            <p className="text-[10px] text-muted lg:text-[11px]">
              or choose a file · {RECORDING_UPLOAD.allowedExtensionsLabel} · up
              to {RECORDING_UPLOAD.maxSizeLabel}
            </p>
            <Button onPress={selection.openFilePicker}>
              <FolderOpenIcon aria-hidden="true" className="size-3.5" />
              Choose file
            </Button>
          </>
        )}

        <input {...selection.inputProps} />
      </div>

      {selection.error ? <ErrorText>{selection.error}</ErrorText> : null}
    </div>
  );
}
