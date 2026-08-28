import { Logger } from '@nestjs/common';
import type {
  HookJSONOutput,
  PostToolUseHookInput,
  PreToolUseHookInput,
  SyncHookJSONOutput,
} from '@anthropic-ai/claude-agent-sdk';
import {
  auditLog,
  createCallBudgetHook,
  createMeetingHooks,
  DEFAULT_TOOL_CALL_BUDGET,
  preToolUseGuard,
} from './hooks';

/** Every hook in this file only ever returns the sync shape — narrows past the `async` variant. */
function sync(result: HookJSONOutput): SyncHookJSONOutput {
  return result as SyncHookJSONOutput;
}

function preToolUseInput(
  overrides: Partial<PreToolUseHookInput> = {},
): PreToolUseHookInput {
  return {
    session_id: 'session-1',
    transcript_path: '/tmp/transcript.jsonl',
    cwd: '/tmp',
    hook_event_name: 'PreToolUse',
    tool_name: 'mcp__meeting__upsert_task',
    tool_input: { title: 'Draft the roadmap doc' },
    tool_use_id: 'tool-1',
    ...overrides,
  };
}

function postToolUseInput(
  overrides: Partial<PostToolUseHookInput> = {},
): PostToolUseHookInput {
  return {
    session_id: 'session-1',
    transcript_path: '/tmp/transcript.jsonl',
    cwd: '/tmp',
    hook_event_name: 'PostToolUse',
    tool_name: 'mcp__meeting__upsert_task',
    tool_input: { title: 'Draft the roadmap doc' },
    tool_response: { id: 'task-1' },
    tool_use_id: 'tool-1',
    ...overrides,
  };
}

const hookOptions = { signal: new AbortController().signal };

describe('preToolUseGuard', () => {
  it('denies an upsert_task call with a missing title', async () => {
    const result = await preToolUseGuard(
      preToolUseInput({ tool_input: {} }),
      'tool-1',
      hookOptions,
    );

    expect(sync(result).hookSpecificOutput).toMatchObject({
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
    });
  });

  it('denies an upsert_task call with a title shorter than 3 characters', async () => {
    const result = await preToolUseGuard(
      preToolUseInput({ tool_input: { title: 'ab' } }),
      'tool-1',
      hookOptions,
    );

    expect(sync(result).hookSpecificOutput).toMatchObject({
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
    });
  });

  it('denies an upsert_task call whose title is only whitespace', async () => {
    const result = await preToolUseGuard(
      preToolUseInput({ tool_input: { title: '   ' } }),
      'tool-1',
      hookOptions,
    );

    expect(sync(result).hookSpecificOutput).toMatchObject({
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
    });
  });

  it('lets an upsert_task call with a valid title through', async () => {
    const result = await preToolUseGuard(
      preToolUseInput(),
      'tool-1',
      hookOptions,
    );

    expect(result).toEqual({});
  });

  it('ignores calls to a different tool', async () => {
    const result = await preToolUseGuard(
      preToolUseInput({
        tool_name: 'mcp__meeting__find_tasks',
        tool_input: {},
      }),
      'tool-1',
      hookOptions,
    );

    expect(result).toEqual({});
  });

  it('ignores non-PreToolUse events', async () => {
    const result = await preToolUseGuard(
      postToolUseInput({ tool_input: {} }),
      'tool-1',
      hookOptions,
    );

    expect(result).toEqual({});
  });
});

describe('createCallBudgetHook', () => {
  it('allows calls up to the limit and denies once it is exceeded', async () => {
    const hook = createCallBudgetHook(2);

    const first = await hook(preToolUseInput(), 'tool-1', hookOptions);
    const second = await hook(preToolUseInput(), 'tool-2', hookOptions);
    const third = await hook(preToolUseInput(), 'tool-3', hookOptions);

    expect(first).toEqual({});
    expect(second).toEqual({});
    expect(sync(third).hookSpecificOutput).toMatchObject({
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
    });
  });

  it('defaults to DEFAULT_TOOL_CALL_BUDGET when no limit is given', async () => {
    const hook = createCallBudgetHook();

    for (let i = 0; i < DEFAULT_TOOL_CALL_BUDGET; i++) {
      const result = await hook(preToolUseInput(), `tool-${i}`, hookOptions);
      expect(result).toEqual({});
    }

    const overBudget = await hook(preToolUseInput(), 'tool-over', hookOptions);
    expect(sync(overBudget).hookSpecificOutput).toMatchObject({
      permissionDecision: 'deny',
    });
  });

  it('gives each call to the factory its own counter', async () => {
    const first = createCallBudgetHook(1);
    const second = createCallBudgetHook(1);

    await first(preToolUseInput(), 'tool-1', hookOptions);
    const secondResult = await second(preToolUseInput(), 'tool-2', hookOptions);

    expect(secondResult).toEqual({});
  });

  it('ignores non-PreToolUse events', async () => {
    const hook = createCallBudgetHook(0);

    const result = await hook(postToolUseInput(), 'tool-1', hookOptions);

    expect(result).toEqual({});
  });
});

describe('auditLog', () => {
  it('logs tool_name, tool_input and tool_response for a PostToolUse event', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    const result = await auditLog(
      postToolUseInput({
        tool_name: 'mcp__meeting__upsert_task',
        tool_input: { title: 'Draft the roadmap doc' },
        tool_response: { id: 'task-1' },
      }),
      'tool-1',
      hookOptions,
    );

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('mcp__meeting__upsert_task'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Draft the roadmap doc'),
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('task-1'));
    expect(result).toEqual({});

    logSpy.mockRestore();
  });

  it('ignores non-PostToolUse events', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    const result = await auditLog(preToolUseInput(), 'tool-1', hookOptions);

    expect(logSpy).not.toHaveBeenCalled();
    expect(result).toEqual({});

    logSpy.mockRestore();
  });
});

describe('createMeetingHooks', () => {
  it('registers preToolUseGuard and a call budget hook under PreToolUse, and auditLog under PostToolUse', () => {
    const hooks = createMeetingHooks();

    expect(hooks.PreToolUse).toHaveLength(1);
    expect(hooks.PreToolUse?.[0].hooks).toHaveLength(2);
    expect(hooks.PreToolUse?.[0].hooks[0]).toBe(preToolUseGuard);

    expect(hooks.PostToolUse).toHaveLength(1);
    expect(hooks.PostToolUse?.[0].hooks).toEqual([auditLog]);
  });

  it('passes its callBudget argument through to the call budget hook', async () => {
    const hooks = createMeetingHooks(1);
    const callBudgetHook = hooks.PreToolUse![0].hooks[1];

    await callBudgetHook(preToolUseInput(), 'tool-1', hookOptions);
    const second = await callBudgetHook(
      preToolUseInput(),
      'tool-2',
      hookOptions,
    );

    expect(sync(second).hookSpecificOutput).toMatchObject({
      permissionDecision: 'deny',
    });
  });
});
