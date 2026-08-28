import { Logger, Module } from '@nestjs/common';
import { createMeetingHooks } from '../hooks';
import { CLAUDE_AGENT_RUNNER } from './claude-agent-runner';
import type { ClaudeAgentRunner } from './claude-agent-runner';
import { ClaudeAgentService } from './claude-agent.service';

const logger = new Logger('ClaudeAgent');

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
 * hardcoded `tools` default here — except `options.hooks`, which is always replaced with a fresh
 * `createMeetingHooks()` call (`../hooks`): every caller today is `MeetingSummaryService`, so this
 * hardcodes the `upsert_task` title guard, a per-run tool-call budget, and audit logging at the
 * runner level rather than trusting each caller to opt in, and silently discards any `hooks` a
 * caller passed in `options`. Calling `createMeetingHooks()` fresh on every `runClaudeAgent`
 * invocation (never hoisted to module scope) is what keeps its call-budget counter scoped to this
 * one run instead of leaking across unrelated meetings — see `createCallBudgetHook` in `../hooks`.
 * Authentication comes from `CLAUDE_CODE_OAUTH_TOKEN` in the process environment: the SDK
 * subprocess inherits `process.env` whenever `options.env` is omitted.
 */
const runClaudeAgent: ClaudeAgentRunner = async (
  prompt,
  options,
  meetingId,
) => {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');

  const runOptions = { ...options, hooks: createMeetingHooks() };

  for await (const message of query({ prompt, options: runOptions })) {
    if (message.type !== 'result') {
      continue;
    }

    logger.log(
      `meetingId=${meetingId ?? 'unknown'} total_cost_usd=${message.total_cost_usd} input_tokens=${message.usage.input_tokens} output_tokens=${message.usage.output_tokens}`,
    );

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
