import type { Options } from '@anthropic-ai/claude-agent-sdk';

/** A single-turn Claude Agent SDK call's result: the final text plus, when `options.outputFormat` was set, the validated structured payload. */
export interface ClaudeAgentReply {
  text: string;
  /**
   * The `structured_output` field of the SDK's result message, present only when
   * `options.outputFormat` was set on the call. When it is, `text` may be a placeholder rather than
   * the actual answer — the turn ends on a tool_result carrier, with `structured_output` holding
   * the real, schema-validated output — so a caller that set `outputFormat` must read this field,
   * not `text`.
   */
  structuredOutput: unknown;
}

/** A function that sends a prompt to Claude via the Claude Agent SDK and resolves with its reply. */
export type ClaudeAgentRunner = (
  prompt: string,
  options: Options,
) => Promise<ClaudeAgentReply>;

/** DI token for the `ClaudeAgentRunner` in use — swapped for a stub in tests that don't need the real SDK subprocess. */
export const CLAUDE_AGENT_RUNNER = Symbol('CLAUDE_AGENT_RUNNER');
