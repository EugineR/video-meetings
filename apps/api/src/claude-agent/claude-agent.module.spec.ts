import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  HookCallbackMatcher,
  HookEvent,
} from '@anthropic-ai/claude-agent-sdk';

type CapturedOptions = {
  hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
} & Record<string, unknown>;

interface QueryCall {
  prompt: string;
  options: CapturedOptions;
}

const mockQuery = jest.fn<unknown, [QueryCall]>();

/**
 * `runClaudeAgent` loads `@anthropic-ai/claude-agent-sdk` via a dynamic `import()` (it's ESM-only —
 * see `claude-agent.module.ts`'s own doc comment). A plain `jest.mock()` doesn't intercept that
 * under Jest's `--experimental-vm-modules` VM — it only patches `require`, so the real package
 * would load and this suite would fire real Claude Agent SDK calls (do not remove this mock to
 * "simplify" the setup). `jest.unstable_mockModule` is the API that does intercept a dynamic
 * `import()`, registered before anything requires the module under test below.
 */
(
  jest as unknown as {
    unstable_mockModule: (id: string, factory: () => unknown) => void;
  }
).unstable_mockModule('@anthropic-ai/claude-agent-sdk', () => ({
  query: (call: QueryCall) => mockQuery(call),
}));

function successResult(overrides: Record<string, unknown> = {}) {
  return {
    type: 'result',
    subtype: 'success',
    result: 'ok',
    total_cost_usd: 0.0123,
    usage: { input_tokens: 100, output_tokens: 50 },
    structured_output: undefined,
    ...overrides,
  };
}

/**
 * `require`, not a static/dynamic `import`, is what lets `claude-agent.module.ts` load *after*
 * `unstable_mockModule` above has registered — a static import would be hoisted ahead of it, and a
 * dynamic `import()` here would need an explicit `.js` extension to satisfy `moduleResolution:
 * nodenext` (dynamic `import()` always resolves via the ESM algorithm, even from a CommonJS file)
 * while ts-jest's runtime resolver only knows about the `.ts` source, so a `.js`-suffixed specifier
 * fails at test time despite type-checking.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- see doc comment above */
const { ClaudeAgentModule } =
  require('./claude-agent.module') as typeof import('./claude-agent.module');
const { ClaudeAgentService } =
  require('./claude-agent.service') as typeof import('./claude-agent.service');
/* eslint-enable @typescript-eslint/no-require-imports */

describe('ClaudeAgentModule / runClaudeAgent', () => {
  let service: import('./claude-agent.service').ClaudeAgentService;

  beforeEach(async () => {
    mockQuery.mockReset();
    const moduleRef = await Test.createTestingModule({
      imports: [ClaudeAgentModule],
    }).compile();
    service = moduleRef.get(ClaudeAgentService);
  });

  it('wires PreToolUse: [preToolUseGuard, callBudget] and PostToolUse: [auditLog] into options.hooks', async () => {
    mockQuery.mockReturnValue([successResult()]);

    await service.ask('prompt', { model: 'x', tools: [] }, 'meeting-1');

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [{ options }] = mockQuery.mock.calls[0];
    expect(options.hooks.PreToolUse).toHaveLength(1);
    expect(options.hooks.PreToolUse?.[0].hooks).toHaveLength(2);
    expect(options.hooks.PostToolUse).toHaveLength(1);
    expect(options.hooks.PostToolUse?.[0].hooks).toHaveLength(1);
  });

  it("logs total_cost_usd and usage tied to meetingId when a 'result' message arrives", async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    mockQuery.mockReturnValue([
      successResult({
        total_cost_usd: 0.042,
        usage: { input_tokens: 111, output_tokens: 222 },
      }),
    ]);

    await service.ask('prompt', { model: 'x', tools: [] }, 'meeting-42');

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /meetingId=meeting-42.*total_cost_usd=0\.042.*input_tokens=111.*output_tokens=222/,
      ),
    );

    logSpy.mockRestore();
  });

  it('logs meetingId=unknown when no meetingId is given', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    mockQuery.mockReturnValue([successResult()]);

    await service.ask('prompt', { model: 'x', tools: [] });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('meetingId=unknown'),
    );

    logSpy.mockRestore();
  });

  it('gives each ask() call its own callBudget hook instance', async () => {
    mockQuery.mockReturnValue([successResult()]);

    await service.ask('prompt', { model: 'x', tools: [] }, 'meeting-1');
    const [{ options: firstOptions }] = mockQuery.mock.calls[0];

    await service.ask('prompt', { model: 'x', tools: [] }, 'meeting-2');
    const [{ options: secondOptions }] = mockQuery.mock.calls[1];

    expect(firstOptions.hooks.PreToolUse?.[0].hooks[1]).not.toBe(
      secondOptions.hooks.PreToolUse?.[0].hooks[1],
    );
  });
});
