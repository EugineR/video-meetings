import { Chip } from '@heroui/react';
import type { RecordingStatus } from '@/lib/api';

const STATUS_LABEL: Record<RecordingStatus, string> = {
  UPLOADED: 'Uploaded',
  PROCESSING: 'Processing',
  READY: 'Ready',
  FAILED: 'Failed',
};

const STATUS_COLOR: Record<
  RecordingStatus,
  'accent' | 'warning' | 'success' | 'danger'
> = {
  UPLOADED: 'accent',
  PROCESSING: 'warning',
  READY: 'success',
  FAILED: 'danger',
};

interface RecordingStatusChipProps {
  status: RecordingStatus;
}

export function RecordingStatusChip({ status }: RecordingStatusChipProps) {
  return (
    <Chip color={STATUS_COLOR[status]} variant="soft">
      {STATUS_LABEL[status]}
    </Chip>
  );
}
