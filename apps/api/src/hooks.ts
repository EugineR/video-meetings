import { Logger } from '@nestjs/common';
import type {
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
} from '@anthropic-ai/claude-agent-sdk';
import { MEETING_TOOLS_SERVER_NAME } from './meeting-tools';

const logger = new Logger('MeetingHooks');

/** Fully-qualified MCP name of the `meeting` server's `upsert_task` tool — see `meeting-tools.ts`. */
const UPSERT_TASK_TOOL_NAME = `mcp__${MEETING_TOOLS_SERVER_NAME}__upsert_task`;

/**
 * Below this length an `upsert_task` title is rejected outright. `upsert_task`'s own Zod schema
 * only requires `title.min(1)` (see `meeting-tools.ts`), which lets through junk like a single
 * punctuation character or an obviously truncated fragment; this hook enforces the stricter
 * quality bar the tool schema deliberately doesn't, without changing the schema every other caller
 * (including tests) relies on.
 */
const MIN_TASK_TITLE_LENGTH = 3;

/** Default cap `createCallBudgetHook` enforces when its caller doesn't pass an explicit `limit`. */
export const DEFAULT_TOOL_CALL_BUDGET = 20;

/**
 * `PreToolUse` hook denying `mcp__meeting__upsert_task` calls whose `title` is missing, blank, or
 * shorter than `MIN_TASK_TITLE_LENGTH`. Lets every other tool call through untouched — including
 * other `upsert_task` calls that already pass the check — by returning `{}` (no
 * `hookSpecificOutput`, so the SDK falls back to its normal permission flow).
 */
export const preToolUseGuard: HookCallback = (input) => {
  if (
    input.hook_event_name !== 'PreToolUse' ||
    input.tool_name !== UPSERT_TASK_TOOL_NAME
  ) {
    return Promise.resolve({});
  }

  const title = (input.tool_input as { title?: unknown } | null)?.title;
  if (
    typeof title !== 'string' ||
    title.trim().length < MIN_TASK_TITLE_LENGTH
  ) {
    return Promise.resolve({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `upsert_task title must be at least ${MIN_TASK_TITLE_LENGTH} non-blank characters, got ${JSON.stringify(title)}.`,
      },
    });
  }

  return Promise.resolve({});
};

/**
 * Builds a `PreToolUse` hook that denies every tool call once the run's total tool-call count goes
 * past `limit` (default `DEFAULT_TOOL_CALL_BUDGET`). The count is kept in a closure, so **each
 * call to this factory starts its own counter at zero** — callers must call it fresh per agent run
 * (see `createMeetingHooks` below) rather than sharing one hook instance across runs, or the budget
 * would apply across unrelated meetings instead of to a single one.
 */
export function createCallBudgetHook(
  limit: number = DEFAULT_TOOL_CALL_BUDGET,
): HookCallback {
  let callCount = 0;

  return (input) => {
    if (input.hook_event_name !== 'PreToolUse') {
      return Promise.resolve({});
    }

    callCount += 1;
    if (callCount > limit) {
      return Promise.resolve({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `Tool call budget exceeded: ${callCount}/${limit} tool calls in this run.`,
        },
      });
    }

    return Promise.resolve({});
  };
}

/**
 * `PostToolUse`/`PostToolUseFailure` hook logging every completed or failed tool call — name,
 * arguments, and result/error — through Nest's `Logger`. Read-only: it never returns
 * `hookSpecificOutput`, so it can't influence what the agent sees or does.
 *
 * Registered under both events (see `createMeetingHooks`) because they're mutually exclusive ways
 * a tool call can finish: `PostToolUse` fires when the tool handler returns normally (including an
 * MCP tool that reports its own failure via `{ isError: true }`, e.g. `update_meeting` against a
 * deleted meeting — see `meeting-tools.ts`), `PostToolUseFailure` fires when the handler throws
 * instead. Logging only `PostToolUse` would silently drop every thrown-exception failure now that
 * `meeting-tools.ts`'s handlers no longer log their own calls. Both a thrown exception and an
 * `isError: true` result log at `warn` instead of `log`, so severity-filtered monitoring still
 * catches them the way the handlers' own `logger.warn` calls used to before this centralized hook
 * replaced them.
 */
export const auditLog: HookCallback = (input) => {
  if (input.hook_event_name === 'PostToolUseFailure') {
    logger.warn(
      `tool_name=${input.tool_name} tool_input=${JSON.stringify(input.tool_input)} error=${input.error}`,
    );
    return Promise.resolve({});
  }

  if (input.hook_event_name !== 'PostToolUse') {
    return Promise.resolve({});
  }

  const isError =
    typeof input.tool_response === 'object' &&
    input.tool_response !== null &&
    (input.tool_response as { isError?: unknown }).isError === true;
  const line = `tool_name=${input.tool_name} tool_input=${JSON.stringify(input.tool_input)} tool_response=${JSON.stringify(input.tool_response)}`;

  if (isError) {
    logger.warn(line);
  } else {
    logger.log(line);
  }

  return Promise.resolve({});
};

/**
 * Assembles `preToolUseGuard`, a fresh `createCallBudgetHook`, and `auditLog` — the latter under
 * both `PostToolUse` and `PostToolUseFailure`, see its own doc comment — into the
 * `Partial<Record<HookEvent, HookCallbackMatcher[]>>` shape `Options.hooks` expects, ready to spread
 * into a `ClaudeAgentService.ask` call's `options`:
 *
 * ```ts
 * const options: Parameters<ClaudeAgentService['ask']>[1] = {
 *   ...,
 *   mcpServers: { [MEETING_TOOLS_SERVER_NAME]: meetingToolsServer },
 *   allowedTools: MEETING_ALLOWED_TOOLS,
 *   hooks: createMeetingHooks(),
 * };
 * await this.claudeAgentService.ask(prompt, options);
 * ```
 *
 * `ClaudeAgentService.ask` forwards `options` (hooks included) straight through to the SDK's
 * `query({ prompt, options })` call in `claude-agent.module.ts` — there is no separate
 * registration step beyond passing them here.
 *
 * Call this once per agent run (never reuse the returned object across runs) so `callBudget`'s
 * counter starts fresh each time — see `createCallBudgetHook`.
 */
export function createMeetingHooks(
  callBudget: number = DEFAULT_TOOL_CALL_BUDGET,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return {
    PreToolUse: [
      { hooks: [preToolUseGuard, createCallBudgetHook(callBudget)] },
    ],
    PostToolUse: [{ hooks: [auditLog] }],
    PostToolUseFailure: [{ hooks: [auditLog] }],
  };
}
