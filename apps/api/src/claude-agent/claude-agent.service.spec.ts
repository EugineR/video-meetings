import 'dotenv/config';
import { Test } from '@nestjs/testing';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeAgentModule } from './claude-agent.module';
import { ClaudeAgentService } from './claude-agent.service';
import type { ClaudeAgentRunner } from './claude-agent-runner';

const HAIKU_MODEL = 'claude-haiku-4-5';

describe('ClaudeAgentService', () => {
  it('delegates to the injected ClaudeAgentRunner', async () => {
    const runClaudeAgent = jest
      .fn<ReturnType<ClaudeAgentRunner>, [string, Options]>()
      .mockResolvedValue({ text: 'pong', structuredOutput: undefined });
    const service = new ClaudeAgentService(runClaudeAgent);
    const options: Options = { model: HAIKU_MODEL, tools: [] };

    const result = await service.ask('ping', options);

    expect(runClaudeAgent).toHaveBeenCalledWith('ping', options);
    expect(result).toEqual({ text: 'pong', structuredOutput: undefined });
  });

  it('propagates a rejection from the injected ClaudeAgentRunner', async () => {
    const runClaudeAgent = jest
      .fn<ReturnType<ClaudeAgentRunner>, [string, Options]>()
      .mockRejectedValue(
        new Error('Claude agent query failed: error_during_execution'),
      );
    const service = new ClaudeAgentService(runClaudeAgent);

    await expect(
      service.ask('ping', { model: HAIKU_MODEL, tools: [] }),
    ).rejects.toThrow('Claude agent query failed');
  });
});

const describeIfOAuthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN
  ? describe
  : describe.skip;

describeIfOAuthToken('ClaudeAgentModule (real Claude Agent SDK call)', () => {
  it('gets a real reply from Claude via CLAUDE_CODE_OAUTH_TOKEN', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ClaudeAgentModule],
    }).compile();
    const service = moduleRef.get(ClaudeAgentService);

    const result = await service.ask('Reply with exactly one word: PONG', {
      model: HAIKU_MODEL,
      tools: [],
    });

    expect(result.text.toLowerCase()).toContain('pong');
  }, 60000);
});
