import { Logger, Module } from '@nestjs/common';
import { createMeetingHooks } from '../hooks';
import { CLAUDE_AGENT_RUNNER } from './claude-agent-runner';
import type { ClaudeAgentRunner } from './claude-agent-runner';
import { ClaudeAgentService } from './claude-agent.service';

const logger = new Logger('ClaudeAgent');

/**
 * How long `runClaudeAgent` waits for the SDK subprocess to produce a `result` message before
 * aborting the run. Without this, a hung subprocess (stalled network call, a stuck tool round-trip)
 * left `MeetingSummaryService.generateForMeeting` waiting on `query()` forever, keeping the
 * meeting's `MeetingSummary.status` stuck at `PROCESSING` and the web UI's "Generating summary…"
 * spinner spinning indefinitely — there was nothing to time it out.
 */
export const CLAUDE_AGENT_TIMEOUT_MS = 3 * 60 * 1000;

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
 *
 * `options.abortController` is likewise always replaced with a fresh one, wired to a
 * `CLAUDE_AGENT_TIMEOUT_MS` timer: aborting it makes the SDK close the subprocess's stdin and kill
 * it if it doesn't exit on its own (the SDK's own graceful-shutdown path), rather than leaving the
 * run hanging forever. Whichever path ends the loop — the abort surfaces as a thrown error from
 * `query()`, or the generator just ends without ever yielding a `result` message — the `catch`
 * below turns it into one clear timeout error once `abortController.signal.aborted` is set,
 * instead of the generic (and, here, misleading) "ended without a result message" message.
 */
const runClaudeAgent: ClaudeAgentRunner = async (
  prompt,
  options,
  meetingId,
) => {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');

  const abortController = new AbortController();
  const timeoutId = setTimeout(
    () => abortController.abort(),
    CLAUDE_AGENT_TIMEOUT_MS,
  );

  const runOptions = {
    ...options,
    hooks: createMeetingHooks(),
    abortController,
  };

  try {
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
  } catch (err) {
    if (abortController.signal.aborted) {
      throw new Error(
        `Claude agent query timed out after ${CLAUDE_AGENT_TIMEOUT_MS}ms for meetingId=${meetingId ?? 'unknown'} and was aborted`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
};

@Module({
  providers: [
    ClaudeAgentService,
    { provide: CLAUDE_AGENT_RUNNER, useValue: runClaudeAgent },
  ],
  exports: [ClaudeAgentService],
})
export class ClaudeAgentModule {}
