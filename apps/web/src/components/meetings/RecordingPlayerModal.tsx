'use client';

import { Modal } from '@heroui/react';
import { getRecordingContentUrl, type Recording } from '@/lib/api';

interface RecordingPlayerModalProps {
  meetingId: string;
  recording: Recording;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

export function RecordingPlayerModal({
  meetingId,
  recording,
  isOpen,
  onOpenChange,
}: RecordingPlayerModalProps) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container size="lg">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading className="truncate">
              {recording.originalFilename}
            </Modal.Heading>
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
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
