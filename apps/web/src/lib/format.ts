const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatDateTime(value: string | Date): string {
  return dateTimeFormatter.format(
    typeof value === 'string' ? new Date(value) : value,
  );
}
