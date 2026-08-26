import type { Options } from '@anthropic-ai/claude-agent-sdk';

/** A function that sends a prompt to Claude via the Claude Agent SDK and resolves with its final text response. */
export type ClaudeAgentRunner = (
  prompt: string,
  options: Options,
) => Promise<string>;

/** DI token for the `ClaudeAgentRunner` in use — swapped for a stub in tests that don't need the real SDK subprocess. */
export const CLAUDE_AGENT_RUNNER = Symbol('CLAUDE_AGENT_RUNNER');
