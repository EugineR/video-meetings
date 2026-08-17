'use client';

import { useState } from 'react';
import { Button, Modal } from '@heroui/react';
import {
  ApiError,
  deleteMeetingRecording,
  getRecordingContentUrl,
  type Recording,
} from '@/lib/api';
import { TrashIcon } from '@/components/icons';
import { RecordingStatusChip } from './RecordingStatusChip';

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatFileSize(sizeBytes: string): string {
  const bytes = Number(sizeBytes);
  if (!Number.isFinite(bytes)) return 'Unknown size';

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

interface RecordingCardProps {
  meetingId: string;
  recording: Recording;
  onReplace: () => void;
  onDeleted: () => void;
}

export function RecordingCard({
  meetingId,
  recording,
  onReplace,
  onDeleted,
}: RecordingCardProps) {
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    setError(null);
    try {
      await deleteMeetingRecording(meetingId);
      setIsDeleteOpen(false);
      onDeleted();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not delete the recording. Please try again.',
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <video
        className="w-full rounded-lg bg-black"
        controls
        src={getRecordingContentUrl(meetingId)}
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{recording.originalFilename}</p>
          <p className="text-sm text-muted">
            {formatFileSize(recording.sizeBytes)} · Uploaded{' '}
            {dateFormatter.format(new Date(recording.createdAt))}
          </p>
        </div>
        <RecordingStatusChip status={recording.status} />
      </div>

      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button
          className="h-11 md:h-10"
          onPress={onReplace}
          variant="secondary"
        >
          Replace
        </Button>
        <Button
          className="h-11 md:h-10"
          onPress={() => setIsDeleteOpen(true)}
          variant="danger"
        >
          <TrashIcon className="size-4" />
          Delete
        </Button>
      </div>

      <Modal.Backdrop isOpen={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-[400px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Delete recording?</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p>
                This will permanently delete “{recording.originalFilename}”.
                This can&apos;t be undone.
              </p>
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close" variant="secondary">
                Cancel
              </Button>
              <Button
                isPending={isDeleting}
                onPress={() => void handleConfirmDelete()}
                variant="danger"
              >
                Delete
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
