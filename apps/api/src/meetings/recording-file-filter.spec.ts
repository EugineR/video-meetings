import {
  assertKnownRecordingMimeTypes,
  isAllowedRecordingFile,
  parseAllowedMimeTypes,
} from './recording-file-filter';

describe('parseAllowedMimeTypes', () => {
  it('splits, trims and drops empty entries', () => {
    expect(
      parseAllowedMimeTypes(' video/mp4, video/webm ,, video/quicktime'),
    ).toEqual(['video/mp4', 'video/webm', 'video/quicktime']);
  });
});

describe('isAllowedRecordingFile', () => {
  const allowed = ['video/mp4', 'video/webm', 'video/quicktime'];

  it('accepts a MIME type + matching extension pair on the allowlist', () => {
    expect(isAllowedRecordingFile('video/mp4', 'clip.mp4', allowed)).toBe(true);
  });

  it('rejects a MIME type not on the allowlist', () => {
    expect(
      isAllowedRecordingFile('application/zip', 'archive.zip', allowed),
    ).toBe(false);
  });

  it('rejects an allowlisted MIME type paired with the wrong extension', () => {
    expect(isAllowedRecordingFile('video/mp4', 'clip.exe', allowed)).toBe(
      false,
    );
  });

  it('is case-insensitive on the extension', () => {
    expect(isAllowedRecordingFile('video/mp4', 'CLIP.MP4', allowed)).toBe(true);
  });
});

describe('assertKnownRecordingMimeTypes', () => {
  it('does not throw for MIME types with a known extension mapping', () => {
    expect(() =>
      assertKnownRecordingMimeTypes(['video/mp4', 'video/webm']),
    ).not.toThrow();
  });

  it('throws for a MIME type with no known extension mapping', () => {
    expect(() =>
      assertKnownRecordingMimeTypes(['video/mp4', 'video/x-matroska']),
    ).toThrow(/video\/x-matroska/);
  });
});
