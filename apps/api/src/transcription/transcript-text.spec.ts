import { extractTranscriptText } from './transcript-text';

describe('extractTranscriptText', () => {
  it('strips a single segment timestamp prefix', () => {
    expect(
      extractTranscriptText('[00:00:00.000 --> 00:00:02.500]   Hello, world.'),
    ).toBe('Hello, world.');
  });

  it('strips timestamps from multiple segments and joins them with a single space', () => {
    const raw = [
      '[00:00:00.000 --> 00:00:02.500]   Hello there.',
      '[00:00:02.500 --> 00:00:05.120]   How are you?',
    ].join('\n');

    expect(extractTranscriptText(raw)).toBe('Hello there. How are you?');
  });

  it('drops blank lines and collapses internal whitespace', () => {
    const raw = [
      '[00:00:00.000 --> 00:00:01.000]   Hello   there.',
      '',
      '[00:00:01.000 --> 00:00:02.000]   Bye.',
      '   ',
    ].join('\n');

    expect(extractTranscriptText(raw)).toBe('Hello there. Bye.');
  });

  it('returns an empty string for output with no spoken segments', () => {
    expect(extractTranscriptText('\n\n   \n')).toBe('');
  });

  it('leaves a line untouched when it has no timestamp prefix to strip', () => {
    expect(extractTranscriptText('plain text, no brackets')).toBe(
      'plain text, no brackets',
    );
  });
});
