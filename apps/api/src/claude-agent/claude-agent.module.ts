import { Module } from '@nestjs/common';
import { CLAUDE_AGENT_RUNNER } from './claude-agent-runner';
import type { ClaudeAgentRunner } from './claude-agent-runner';
import { ClaudeAgentService } from './claude-agent.service';

/**
 * Runs a single-turn Claude Agent SDK query and returns its final text.
 *
 * `@anthropic-ai/claude-agent-sdk` is ESM-only, while this app compiles to CommonJS
 * (`tsconfig.json`'s `module: "nodenext"` follows `apps/api/package.json`'s lack of
 * `"type": "module"`), so it's loaded via a dynamic `import()` rather than a static one.
 * Jest's CommonJS test VM needs `--experimental-vm-modules` (set on the `test`/`test:watch`/
 * `test:cov` scripts) to support that dynamic import.
 *
 * `options` is forwarded to `query()` as-is — see `ClaudeAgentService` for why there is no
 * hardcoded `tools` default here. Authentication comes from `CLAUDE_CODE_OAUTH_TOKEN` in the
 * process environment: the SDK subprocess inherits `process.env` whenever `options.env` is
 * omitted.
 */
const runClaudeAgent: ClaudeAgentRunner = async (prompt, options) => {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');

  for await (const message of query({ prompt, options })) {
    if (message.type !== 'result') {
      continue;
    }
    if (message.subtype === 'success') {
      return {
        text: message.result,
        structuredOutput: message.structured_output,
      };
    }
    throw new Error(`Claude agent query failed: ${message.subtype}`);
  }

  throw new Error('Claude agent query ended without a result message');
};

@Module({
  providers: [
    ClaudeAgentService,
    { provide: CLAUDE_AGENT_RUNNER, useValue: runClaudeAgent },
  ],
  exports: [ClaudeAgentService],
})
export class ClaudeAgentModule {}
