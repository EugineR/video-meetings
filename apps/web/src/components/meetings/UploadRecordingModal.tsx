'use client';

import { Modal } from '@heroui/react';
import type { Recording } from '@/lib/api';
import { RecordingUploader } from './RecordingUploader';

interface UploadRecordingModalProps {
  meetingId: string;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onUploaded: (recording: Recording) => void;
}

export function UploadRecordingModal({
  meetingId,
  isOpen,
  onOpenChange,
  onUploaded,
}: UploadRecordingModalProps) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[440px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>Upload recording</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <RecordingUploader meetingId={meetingId} onUploaded={onUploaded} />
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
