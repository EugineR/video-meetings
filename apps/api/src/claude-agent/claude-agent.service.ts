import { Inject, Injectable } from '@nestjs/common';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { CLAUDE_AGENT_RUNNER } from './claude-agent-runner';
import type {
  ClaudeAgentReply,
  ClaudeAgentRunner,
} from './claude-agent-runner';

/**
 * Thin wrapper around the Claude Agent SDK. The actual `query()` invocation lives behind the
 * injected `ClaudeAgentRunner` so it can be stubbed in tests, the same shape as
 * `TranscriptionService`/`WhisperRunner`.
 *
 * `options` is passed through to the SDK almost verbatim (model, tools, permissionMode, cwd,
 * mcpServers, ...) — there is no safe default applied here. In particular, a caller that omits
 * `options.tools` gets whatever the SDK's own default is (the full built-in Claude Code toolset,
 * including Bash and file access, running on this server's filesystem). Callers that only want a
 * plain text reply must pass `tools: []` themselves.
 */
@Injectable()
export class ClaudeAgentService {
  constructor(
    @Inject(CLAUDE_AGENT_RUNNER)
    private readonly runClaudeAgent: ClaudeAgentRunner,
  ) {}

  ask(prompt: string, options: Options): Promise<ClaudeAgentReply> {
    return this.runClaudeAgent(prompt, options);
  }
}
