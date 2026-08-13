import type { Meeting } from '@/lib/api';
import { CalendarIcon, UsersIcon } from '@/components/icons';

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

interface MeetingRowProps {
  meeting: Meeting;
  highlighted?: boolean;
}

export function MeetingRow({ meeting, highlighted }: MeetingRowProps) {
  return (
    <li
      className={`rounded-lg border px-4 py-3 ${
        highlighted
          ? 'border-accent/30 bg-accent/10'
          : 'border-default-200 bg-default-50'
      }`}
    >
      <p className="font-medium">{meeting.title}</p>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
        <CalendarIcon aria-hidden="true" className="size-4 shrink-0" />
        {dateFormatter.format(new Date(meeting.date))}
      </p>
      {meeting.participants.length > 0 ? (
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
          <UsersIcon aria-hidden="true" className="size-4 shrink-0" />
          {meeting.participants.join(', ')}
        </p>
      ) : null}
    </li>
  );
}
