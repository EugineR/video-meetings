/**
 * Splits the free-text participants field into the string array the API takes.
 * Blank entries are dropped, so a trailing comma or a stray space produces `[]`
 * rather than an empty participant — `CreateMeetingDto.participants` has no
 * `@IsOptional()`, so the array is always sent, never omitted.
 */
export function parseParticipants(value: string): string[] {
  return value
    .split(',')
    .map((participant) => participant.trim())
    .filter((participant) => participant.length > 0);
}
