import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Full-flow test of the command generation endpoint: real endpoint, real
// tool-calling loop, real tool executor. Only the OpenAI API and the read
// model HTTP calls are faked.

// Hoisted: the llm.js mock below constructs the client at mock time
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

// Force the real (non-mock) LLM client regardless of LLM_MOCK in the env
vi.mock('$lib/server/llm.js', async () => {
  const { createLlmClient } = await import('$lib/server/llm-client.js');
  return {
    llmClient: createLlmClient({ apiKey: 'test-key', model: 'test-model' }),
  };
});

import { POST } from './+server.js';

const oliver = { id: 'cxhnLJyhRmDrifpAFWNjr', name: 'Oliver', location: 'Mainz' };

const toolCallResponse = (id, name, args) => ({
  usage: { total_tokens: 10 },
  choices: [
    {
      finish_reason: 'tool_calls',
      message: {
        content: null,
        tool_calls: [
          { id, type: 'function', function: { name, arguments: JSON.stringify(args) } },
        ],
      },
    },
  ],
});

const textResponse = (content) => ({
  usage: { total_tokens: 10 },
  choices: [{ finish_reason: 'stop', message: { content } }],
});

const post = (body) =>
  POST({
    request: new Request('http://localhost/api/llm/generate-commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  }).then((res) => res.json());

describe('generate-commands endpoint: tool_choice configuration', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate
      .mockResolvedValueOnce(
        toolCallResponse('call_1', 'lookup_customers', { query: 'Oli' }),
      )
      .mockResolvedValueOnce(
        textResponse(
          JSON.stringify({
            commands: [
              {
                aggregateName: 'order',
                aggregateId: 'new-1',
                command: 'CREATE',
                payload: { customerId: oliver.id, text: 'Football', value: 19.99 },
              },
            ],
          }),
        ),
      );
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve([oliver]) }),
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  const ask = () =>
    post({
      text: 'Oli wants to order a football',
      context: { customers: [], orders: [] },
      conversationHistory: [],
    });

  test('forces a tool call on the first request by default', async () => {
    vi.stubEnv('LLM_GENCMD_TOOL_CHOICE', '');
    const result = await ask();

    expect(mockCreate.mock.calls[0][0]).toHaveProperty('tool_choice', 'required');
    expect(mockCreate.mock.calls[1][0]).not.toHaveProperty('tool_choice');
    expect(result.toolChoice).toBe('required');
    expect(result.commands).toHaveLength(1);
  });

  test('LLM_GENCMD_TOOL_CHOICE=auto sends no tool_choice at all', async () => {
    vi.stubEnv('LLM_GENCMD_TOOL_CHOICE', 'auto');
    const result = await ask();

    mockCreate.mock.calls.forEach(([params]) =>
      expect(params).not.toHaveProperty('tool_choice'),
    );
    expect(result.toolChoice).toBe('auto');
    expect(result.commands).toHaveLength(1);
  });

  test('unknown LLM_GENCMD_TOOL_CHOICE value falls back to required', async () => {
    vi.stubEnv('LLM_GENCMD_TOOL_CHOICE', 'sometimes');
    const result = await ask();

    expect(mockCreate.mock.calls[0][0]).toHaveProperty('tool_choice', 'required');
    expect(result.toolChoice).toBe('required');
  });
});
