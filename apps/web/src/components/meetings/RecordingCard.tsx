'use client';

import { useState } from 'react';
import { Button, Link, Modal, Spinner } from '@heroui/react';
import { ApiError, deleteMeetingRecording, type Recording } from '@/lib/api';
import { formatDateTime, formatFileSize } from '@/lib/format';
import { ChevronDownIcon, PlayCircleIcon, TrashIcon } from '@/components/icons';
import { ErrorText } from '@/components/ui/ErrorText';
import { RecordingStatusChip } from './RecordingStatusChip';
import { RecordingPlayerModal } from './RecordingPlayerModal';

interface RecordingCardProps {
  meetingId: string;
  recording: Recording;
  onDeleted: (recordingId: string) => void;
}

export function RecordingCard({
  meetingId,
  recording,
  onDeleted,
}: RecordingCardProps) {
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);

  const hasTranscript =
    recording.status === 'READY' && Boolean(recording.transcriptText);
  const isTranscribing =
    recording.status === 'UPLOADED' || recording.status === 'PROCESSING';

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    setError(null);
    try {
      await deleteMeetingRecording(meetingId, recording.id);
      setIsDeleteOpen(false);
      onDeleted(recording.id);
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
    <div className="flex flex-col gap-3 rounded-lg border border-default-200 bg-default-50 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <PlayCircleIcon
          aria-hidden="true"
          className="size-5 shrink-0 text-muted"
        />

        <div className="min-w-0 flex-1">
          <Link
            className="block max-w-full truncate font-medium text-foreground hover:text-accent"
            onPress={() => setIsPlayerOpen(true)}
          >
            {recording.originalFilename}
          </Link>
          <p className="text-sm text-muted">
            {formatFileSize(recording.sizeBytes)} · Added{' '}
            {formatDateTime(recording.createdAt)}
          </p>
        </div>

        <RecordingStatusChip status={recording.status} />

        <Button
          aria-label={`Delete ${recording.originalFilename}`}
          className="text-danger hover:text-danger"
          isIconOnly
          onPress={() => setIsDeleteOpen(true)}
          size="lg"
          variant="ghost"
        >
          <TrashIcon className="size-4" />
        </Button>
      </div>

      {recording.status === 'FAILED' ? (
        <ErrorText>
          Transcription failed. No transcript is available for this recording.
        </ErrorText>
      ) : isTranscribing ? (
        // Occupies the same slot the "Show transcript" toggle takes once ready (same
        // min-height as that button), so transcription finishing doesn't shift the rest
        // of the tile's layout.
        <div className="flex min-h-[44px] items-center gap-2 text-sm text-muted md:min-h-10">
          <Spinner aria-label="Transcribing" size="sm" />
          Transcribing…
        </div>
      ) : hasTranscript ? (
        <div className="flex flex-col gap-2">
          <Button
            aria-expanded={isTranscriptOpen}
            className="w-fit min-h-[44px] gap-1 text-accent hover:text-accent md:min-h-10"
            onPress={() => setIsTranscriptOpen((open) => !open)}
            size="sm"
            variant="ghost"
          >
            {isTranscriptOpen ? 'Hide transcript' : 'Show transcript'}
            <ChevronDownIcon
              aria-hidden="true"
              className={`size-4 transition-transform ${isTranscriptOpen ? 'rotate-180' : ''}`}
            />
          </Button>

          <div
            aria-hidden={!isTranscriptOpen}
            className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
              isTranscriptOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
            }`}
          >
            <div className="overflow-hidden">
              <div className="flex flex-col gap-1.5 rounded-lg bg-muted/10 p-4">
                <p className="text-sm font-medium">Transcript</p>
                <p className="max-h-64 overflow-y-auto text-sm whitespace-pre-wrap text-muted">
                  {recording.transcriptText}
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {error ? <ErrorText>{error}</ErrorText> : null}

      <RecordingPlayerModal
        isOpen={isPlayerOpen}
        meetingId={meetingId}
        onOpenChange={setIsPlayerOpen}
        recording={recording}
      />

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
