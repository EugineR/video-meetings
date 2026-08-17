export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parses a single-range `Range: bytes=start-end` header (the only form browsers send when
 * seeking a `<video>`). Returns `null` when the header is absent, malformed, or unsatisfiable
 * (start beyond `totalSize`) — callers then fall back to serving the full file with a 200.
 */
export function parseRange(
  rangeHeader: string | undefined,
  totalSize: number,
): ByteRange | null {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) {
    return null;
  }

  const [, startStr, endStr] = match;
  if (startStr === '' && endStr === '') {
    return null;
  }

  let start: number;
  let end: number;
  if (startStr === '') {
    // Suffix range (e.g. "bytes=-500"): the last N bytes of the file.
    start = Math.max(totalSize - Number(endStr), 0);
    end = totalSize - 1;
  } else {
    start = Number(startStr);
    end = endStr === '' ? totalSize - 1 : Number(endStr);
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start > end ||
    start >= totalSize
  ) {
    return null;
  }

  return { start, end: Math.min(end, totalSize - 1) };
}
