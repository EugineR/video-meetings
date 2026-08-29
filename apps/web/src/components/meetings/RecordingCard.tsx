'use client';

import { useState } from 'react';
import { Spinner } from '@heroui/react';
import { ApiError, deleteMeetingRecording, type Recording } from '@/lib/api';
import { formatDateTime, formatFileSize } from '@/lib/format';
import { touchTarget } from '@/lib/touchTarget';
import { ChevronDownIcon, PlayCircleIcon, TrashIcon } from '@/components/icons';
import { RecordingPlayerModal } from '@/components/meetings/RecordingPlayerModal';
import { RecordingStatusChip } from '@/components/meetings/RecordingStatusChip';
import { Button } from '@/components/ui/Button';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { ErrorText } from '@/components/ui/ErrorText';

interface RecordingCardProps {
  meetingId: string;
  onDeleted: (recordingId: string) => void;
  recording: Recording;
}

export function RecordingCard({
  meetingId,
  onDeleted,
  recording,
}: RecordingCardProps) {
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);

  const hasTranscript =
    recording.status === 'READY' && Boolean(recording.transcriptText);
  const isTranscribing =
    recording.status === 'UPLOADED' || recording.status === 'PROCESSING';

  const handleDeleteOpenChange = (isOpen: boolean) => {
    setDeleteError(null);
    setIsDeleteOpen(isOpen);
  };

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteMeetingRecording(meetingId, recording.id);
      setIsDeleteOpen(false);
      onDeleted(recording.id);
    } catch (err) {
      setDeleteError(
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
        {/* The whole title block is the button that opens the player. It used to be an
            `href`-less `<Link onPress>`, which announced itself as a link that went
            nowhere; a button is what it always was. Its label carries the filename and
            the meta line, so the two lines below are spans rather than a sibling <p>. */}
        <Button
          className="min-w-0 flex-1 justify-start gap-3 rounded-lg px-2 py-1 font-normal"
          onPress={() => setIsPlayerOpen(true)}
          touchTarget="block"
          variant="ghost"
        >
          <PlayCircleIcon
            aria-hidden="true"
            className="size-5 shrink-0 text-muted"
          />
          <span className="flex min-w-0 flex-1 flex-col text-left">
            <span className="truncate text-base font-medium">
              {recording.originalFilename}
            </span>
            <span className="truncate text-sm text-muted">
              {formatFileSize(recording.sizeBytes)} · Added{' '}
              {formatDateTime(recording.createdAt)}
            </span>
          </span>
        </Button>

        <RecordingStatusChip status={recording.status} />

        <Button
          aria-label={`Delete ${recording.originalFilename}`}
          className="text-danger hover:text-danger"
          isIconOnly
          onPress={() => setIsDeleteOpen(true)}
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
        // Occupies the same slot the "Show transcript" toggle takes once ready — hence
        // the same `touchTarget` height the toggle gets from `ui/Button` — so
        // transcription finishing doesn't shift the rest of the tile's layout.
        <div
          className={touchTarget({
            className: 'flex items-center gap-2 text-sm text-muted',
            fit: 'block',
          })}
        >
          <Spinner aria-label="Transcribing" size="sm" />
          Transcribing…
        </div>
      ) : hasTranscript ? (
        <div className="flex flex-col gap-2">
          <Button
            aria-expanded={isTranscriptOpen}
            className="w-fit gap-1 text-accent hover:text-accent"
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

      <RecordingPlayerModal
        isOpen={isPlayerOpen}
        meetingId={meetingId}
        onOpenChange={setIsPlayerOpen}
        recording={recording}
      />

      <ConfirmModal
        confirmLabel="Delete"
        error={deleteError}
        heading="Delete recording?"
        isOpen={isDeleteOpen}
        isPending={isDeleting}
        onConfirm={() => void handleConfirmDelete()}
        onOpenChange={handleDeleteOpenChange}
      >
        <p>
          This will permanently delete “{recording.originalFilename}”. This
          can&apos;t be undone.
        </p>
      </ConfirmModal>
    </div>
  );
}
