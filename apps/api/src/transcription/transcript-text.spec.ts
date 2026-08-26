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

  it('drops a line with no timestamp prefix instead of keeping it verbatim', () => {
    expect(extractTranscriptText('plain text, no brackets')).toBe('');
  });

  it('drops non-segment lines interleaved with real segments', () => {
    const raw = [
      'whisper_model_load: loading model',
      '[00:00:00.000 --> 00:00:01.000]   Hello there.',
      'whisper_print_timings:     load time =   106.65 ms',
    ].join('\n');

    expect(extractTranscriptText(raw)).toBe('Hello there.');
  });
});
