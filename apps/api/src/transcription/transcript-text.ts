/** Matches whisper.cpp's per-segment `[00:00:00.000 --> 00:00:02.500]` prefix on a line of stdout output. */
const SEGMENT_TIMESTAMP_PATTERN =
  /^\[\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}\]\s*/;

/**
 * whisper.cpp's CLI prints one timestamped line per segment; the product only wants the
 * plain spoken text (see the PRD's "no timestamps" scope), so this keeps only lines that
 * carry that prefix, strips it, and joins the remaining text into a single transcript
 * string — a non-segment line (a build banner, a log line) is dropped rather than shown
 * to the user as if it were spoken content.
 */
export function extractTranscriptText(rawWhisperOutput: string): string {
  return rawWhisperOutput
    .split(/\r?\n/)
    .filter((line) => SEGMENT_TIMESTAMP_PATTERN.test(line))
    .map((line) => line.replace(SEGMENT_TIMESTAMP_PATTERN, '').trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
