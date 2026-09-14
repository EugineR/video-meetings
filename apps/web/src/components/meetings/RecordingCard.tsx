'use client';

import { useState } from 'react';
import { deleteMeetingRecording, type Recording } from '@/lib/api';
import { formatDateTime, formatFileSize } from '@/lib/format';
import { useConfirmAction } from '@/lib/useConfirmAction';
import { ChevronDownIcon, PlayIcon, TrashIcon } from '@/components/icons';
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

/**
 * Matches the design's "Recording Tile" (`pcOhu`): a play row (filename/metadata,
 * opens `RecordingPlayerModal`) over a status row pairing `RecordingStatusChip` — moved
 * here from its previous spot next to the delete button, and now the tile's single status
 * indicator — with the "Show/Hide transcript" disclosure, which expands a full-bleed
 * inline transcript panel (`FaM7S`) below. `RecordingStatusChip`'s status→color/label
 * mapping is unchanged (see apps/web/CLAUDE.md); only its position and neighboring markup
 * moved.
 */
export function RecordingCard({
  meetingId,
  onDeleted,
  recording,
}: RecordingCardProps) {
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);
  const deleteAction = useConfirmAction({
    action: async () => {
      await deleteMeetingRecording(meetingId, recording.id);
      onDeleted(recording.id);
    },
    fallbackMessage: 'Could not delete the recording. Please try again.',
  });

  const hasTranscript =
    recording.status === 'READY' && Boolean(recording.transcriptText);

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-[9px] border border-border bg-surface">
      <div className="flex min-w-0 flex-col gap-3 p-3 lg:gap-3.5 lg:p-4">
        <div className="flex min-w-0 items-center gap-3">
          {/* The whole play row is the button that opens the player. It used to be an
              `href`-less `<Link onPress>`, which announced itself as a link that went
              nowhere; a button is what it always was. Its label carries the play-icon
              roundel, the filename and the meta line, so the two lines below are spans
              rather than a sibling <p>. */}
          <Button
            className="min-w-0 flex-1 justify-start gap-3 rounded-lg px-2 py-1.5 font-normal"
            onPress={() => setIsPlayerOpen(true)}
            touchTarget="block"
            variant="ghost"
          >
            <span className="flex size-[38px] shrink-0 items-center justify-center rounded-[9px] bg-accent-soft">
              <PlayIcon
                aria-hidden="true"
                className="size-[18px] text-accent"
              />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-[3px] text-left">
              <span
                className={`truncate text-[11px] font-semibold lg:text-[13px] ${
                  isTranscriptOpen ? 'text-accent-strong' : 'text-foreground'
                }`}
              >
                {recording.originalFilename}
              </span>
              <span className="truncate text-[9px] text-muted lg:text-[10px]">
                {formatFileSize(recording.sizeBytes)} · Added{' '}
                {formatDateTime(recording.createdAt)}
              </span>
            </span>
          </Button>

          <Button
            aria-label={`Delete ${recording.originalFilename}`}
            className="text-danger hover:text-danger"
            isIconOnly
            onPress={deleteAction.open}
            variant="ghost"
          >
            <TrashIcon className="size-[17px]" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <RecordingStatusChip status={recording.status} />

          {hasTranscript ? (
            <Button
              aria-expanded={isTranscriptOpen}
              className="w-fit gap-1.5 px-2 text-[11px] text-accent-strong hover:text-accent-strong"
              onPress={() => setIsTranscriptOpen((open) => !open)}
              size="sm"
              variant="ghost"
            >
              {isTranscriptOpen ? 'Hide transcript' : 'Show transcript'}
              <ChevronDownIcon
                aria-hidden="true"
                className={`size-[14px] transition-transform ${isTranscriptOpen ? 'rotate-180' : ''}`}
              />
            </Button>
          ) : null}
        </div>

        {recording.status === 'FAILED' ? (
          <ErrorText>
            Transcription failed. No transcript is available for this recording.
          </ErrorText>
        ) : null}
      </div>

      {hasTranscript ? (
        <div
          aria-hidden={!isTranscriptOpen}
          className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
            isTranscriptOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          }`}
        >
          <div className="overflow-hidden">
            <div className="flex flex-col gap-[7px] border-t border-border bg-subtle px-3 pt-3 pb-3.5 lg:gap-[9px] lg:px-4 lg:pt-3.5 lg:pb-4">
              <p className="font-head text-[11px] font-semibold text-foreground lg:text-xs">
                Transcript
              </p>
              <p className="max-h-64 overflow-y-auto text-[10px] leading-[1.55] whitespace-pre-wrap text-muted lg:text-[11px]">
                {recording.transcriptText}
              </p>
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
        error={deleteAction.error}
        heading="Delete recording?"
        isOpen={deleteAction.isOpen}
        isPending={deleteAction.isPending}
        onConfirm={deleteAction.onConfirm}
        onOpenChange={deleteAction.onOpenChange}
      >
        <p>
          This will permanently delete “{recording.originalFilename}”. This
          can&apos;t be undone.
        </p>
      </ConfirmModal>
    </div>
  );
}
