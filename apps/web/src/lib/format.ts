const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatDateTime(value: string | Date): string {
  return dateTimeFormatter.format(
    typeof value === 'string' ? new Date(value) : value,
  );
}

/**
 * A byte count (the API sends it as a string, since it can exceed the safe
 * integer range) as the largest unit that keeps it above 1 — bytes whole,
 * everything larger to one decimal. An unparseable value reads "Unknown size"
 * rather than "NaN B".
 */
export function formatFileSize(sizeBytes: string): string {
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

/** Up to two initials from whitespace/punctuation-separated words, e.g. "Jane Doe" -> "JD". */
function initialsFrom(source: string): string {
  const words = source.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

/**
 * The avatar placeholder text: initials from the display name when there is
 * one, otherwise from the email's local part (the whole address if it has no
 * `@`).
 */
export function getInitials(name: string | null, email: string): string {
  const trimmedName = name?.trim();
  if (trimmedName) {
    return initialsFrom(trimmedName);
  }
  const [localPart] = email.split('@');
  return initialsFrom(localPart || email);
}
