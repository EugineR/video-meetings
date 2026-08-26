/** A function that runs local Whisper inference against a file path and resolves with the raw transcript output. */
export type WhisperRunner = (filePath: string) => Promise<string>;

/** DI token for the `WhisperRunner` in use — swapped for a stub in tests so they never shell out to a real whisper.cpp build. */
export const WHISPER_RUNNER = Symbol('WHISPER_RUNNER');
