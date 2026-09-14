'use client';

import { Modal } from '@heroui/react';
import { touchTarget } from '@/lib/touchTarget';
import { getRecordingContentUrl, type Recording } from '@/lib/api';
import { formatDateTime, formatFileSize } from '@/lib/format';
import { FileTextIcon } from '@/components/icons';

interface RecordingPlayerModalProps {
  isOpen: boolean;
  meetingId: string;
  onOpenChange: (isOpen: boolean) => void;
  recording: Recording;
}

/**
 * Matches the design's "Recording Player Dialog" chrome (desktop `d3H49D`, mobile
 * `BvZbc`) for the header (filename + size/date, close icon) and the footer note — the
 * bottom-sheet handle and rounded-top-only corners on mobile come from the same mobile
 * component. Playback itself is untouched: the native `<audio controls>`/`<video
 * controls>` element stays exactly as it was, per the PRD's recording-player-fidelity
 * decision (no custom waveform/progress UI).
 */
export function RecordingPlayerModal({
  isOpen,
  meetingId,
  onOpenChange,
  recording,
}: RecordingPlayerModalProps) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container size="lg">
        <Modal.Dialog className="w-full gap-[14px] rounded-t-2xl border border-border bg-surface p-4 sm:max-w-[780px] sm:gap-[18px] sm:rounded-xl sm:p-[22px] sm:shadow-[0px_16px_42px_rgba(0,0,0,0.25)]">
          <div
            aria-hidden="true"
            className="-mt-2 mb-1 flex h-2 items-center justify-center sm:hidden"
          >
            <span className="h-1 w-9 rounded-full bg-border" />
          </div>

          <Modal.Header className="flex-row items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-[3px]">
              <Modal.Heading className="truncate font-head text-sm font-semibold text-foreground sm:text-[17px]">
                {recording.originalFilename}
              </Modal.Heading>
              <p className="truncate text-[9px] text-muted sm:text-[11px]">
                {formatFileSize(recording.sizeBytes)} ·{' '}
                {formatDateTime(recording.createdAt)}
              </p>
            </div>
            <Modal.CloseTrigger
              className={`static ${touchTarget({ fit: 'square' })}`}
            />
          </Modal.Header>

          <Modal.Body>
            {recording.mimeType === 'audio/mpeg' ? (
              <div className="flex items-center rounded-lg bg-default-50 p-4">
                <audio
                  className="w-full"
                  controls
                  src={getRecordingContentUrl(meetingId, recording.id)}
                />
              </div>
            ) : (
              <video
                className="w-full rounded-lg bg-black"
                controls
                src={getRecordingContentUrl(meetingId, recording.id)}
              />
            )}
          </Modal.Body>

          <div className="flex items-center gap-2 rounded-lg bg-subtle px-3 py-2.5 sm:gap-2.5 sm:py-3">
            <FileTextIcon
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted sm:size-4"
            />
            <p className="text-[9px] text-muted sm:text-[11px]">
              Transcript remains expanded in the recording tile behind this
              player.
            </p>
          </div>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
