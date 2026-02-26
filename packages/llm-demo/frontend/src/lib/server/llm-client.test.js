import { describe, test, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───

const mockCreate = vi.fn();

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  })),
}));

vi.mock('@lazyapps/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { createLlmClient } from './llm-client.js';
import { tools as genTools } from './command-generator.js';

// ─── Helpers ───

const makeToolCallResponse = (toolCalls) => ({
  usage: { total_tokens: 10 },
  choices: [
    {
      finish_reason: 'tool_calls',
      message: {
        content: null,
        tool_calls: toolCalls.map((tc, i) => ({
          id: `call_${i}`,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.args),
          },
        })),
      },
    },
  ],
});

const makeTextResponse = (content) => ({
  usage: { total_tokens: 10 },
  choices: [
    {
      finish_reason: 'stop',
      message: { content },
    },
  ],
});

// ─── toolCompletion: tool_choice behaviour ───

describe('toolCompletion', () => {
  const tools = [
    {
      type: 'function',
      function: {
        name: 'test_tool',
        parameters: { type: 'object', properties: {} },
      },
    },
  ];
  const executeTool = () => ({ result: 'ok' });

  beforeEach(() => {
    mockCreate.mockReset();
  });

  test('first API call includes tool_choice when toolChoice provided', () => {
    mockCreate
      .mockResolvedValueOnce(
        makeToolCallResponse([{ name: 'test_tool', args: {} }]),
      )
      .mockResolvedValueOnce(makeTextResponse('done'));

    const client = createLlmClient({
      apiKey: 'test-key',
      model: 'test-model',
    });
    return client
      .toolCompletion(
        [{ role: 'user', content: 'test' }],
        tools,
        executeTool,
        { toolChoice: 'required' },
      )
      .then(() => {
        expect(mockCreate).toHaveBeenCalledTimes(2);
        expect(mockCreate.mock.calls[0][0]).toHaveProperty(
          'tool_choice',
          'required',
        );
      });
  });

  test('second API call does NOT include tool_choice', () => {
    mockCreate
      .mockResolvedValueOnce(
        makeToolCallResponse([{ name: 'test_tool', args: {} }]),
      )
      .mockResolvedValueOnce(makeTextResponse('done'));

    const client = createLlmClient({
      apiKey: 'test-key',
      model: 'test-model',
    });
    return client
      .toolCompletion(
        [{ role: 'user', content: 'test' }],
        tools,
        executeTool,
        { toolChoice: 'required' },
      )
      .then(() => {
        expect(mockCreate.mock.calls[1][0]).not.toHaveProperty('tool_choice');
      });
  });

  test('no tool_choice in any call when toolChoice not provided', () => {
    mockCreate
      .mockResolvedValueOnce(
        makeToolCallResponse([{ name: 'test_tool', args: {} }]),
      )
      .mockResolvedValueOnce(makeTextResponse('done'));

    const client = createLlmClient({
      apiKey: 'test-key',
      model: 'test-model',
    });
    return client
      .toolCompletion(
        [{ role: 'user', content: 'test' }],
        tools,
        executeTool,
      )
      .then(() => {
        expect(mockCreate).toHaveBeenCalledTimes(2);
        mockCreate.mock.calls.forEach((call) => {
          expect(call[0]).not.toHaveProperty('tool_choice');
        });
      });
  });

  test('returns content, toolCalls, usage, and duration', () => {
    mockCreate
      .mockResolvedValueOnce(
        makeToolCallResponse([
          { name: 'test_tool', args: { q: 'hello' } },
        ]),
      )
      .mockResolvedValueOnce(makeTextResponse('{"commands": []}'));

    const executeFn = () => ({ found: true });
    const client = createLlmClient({
      apiKey: 'test-key',
      model: 'test-model',
    });
    return client
      .toolCompletion(
        [{ role: 'user', content: 'test' }],
        tools,
        executeFn,
        { toolChoice: 'required' },
      )
      .then((result) => {
        expect(result.content).toBe('{"commands": []}');
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].name).toBe('test_tool');
        expect(result.toolCalls[0].args).toEqual({ q: 'hello' });
        expect(result.toolCalls[0].result).toEqual({ found: true });
        expect(result.usage.total_tokens).toBe(20);
        expect(typeof result.duration).toBe('number');
      });
  });

  test('returns immediately when model responds without tool calls', () => {
    mockCreate.mockResolvedValueOnce(
      makeTextResponse('{"commands": []}'),
    );

    const client = createLlmClient({
      apiKey: 'test-key',
      model: 'test-model',
    });
    return client
      .toolCompletion(
        [{ role: 'user', content: 'test' }],
        tools,
        executeTool,
      )
      .then((result) => {
        expect(mockCreate).toHaveBeenCalledTimes(1);
        expect(result.content).toBe('{"commands": []}');
        expect(result.toolCalls).toEqual([]);
      });
  });

  test('respects maxIterations and returns sentinel message', () => {
    // Every call returns tool_calls so the loop never ends naturally
    mockCreate.mockResolvedValue(
      makeToolCallResponse([{ name: 'test_tool', args: {} }]),
    );

    const client = createLlmClient({
      apiKey: 'test-key',
      model: 'test-model',
    });
    return client
      .toolCompletion(
        [{ role: 'user', content: 'test' }],
        tools,
        executeTool,
        { maxIterations: 2 },
      )
      .then((result) => {
        expect(mockCreate).toHaveBeenCalledTimes(2);
        expect(result.content).toBe('Max tool iterations reached');
      });
  });

  test('propagates systemPrompt as first message', () => {
    mockCreate.mockResolvedValueOnce(
      makeTextResponse('{"commands": []}'),
    );

    const client = createLlmClient({
      apiKey: 'test-key',
      model: 'test-model',
    });
    return client
      .toolCompletion(
        [{ role: 'user', content: 'test' }],
        tools,
        executeTool,
        { systemPrompt: 'You are a bot.' },
      )
      .then(() => {
        const messages = mockCreate.mock.calls[0][0].messages;
        expect(messages[0]).toEqual({
          role: 'system',
          content: 'You are a bot.',
        });
        expect(messages[1]).toEqual({
          role: 'user',
          content: 'test',
        });
      });
  });

  test('throws on API error', () => {
    mockCreate.mockRejectedValueOnce(
      Object.assign(new Error('rate limited'), { status: 429 }),
    );

    const client = createLlmClient({
      apiKey: 'test-key',
      model: 'test-model',
    });
    return client
      .toolCompletion(
        [{ role: 'user', content: 'test' }],
        tools,
        executeTool,
      )
      .then(
        () => {
          throw new Error('should have thrown');
        },
        (err) => {
          expect(err.message).toContain('Tool completion failed');
        },
      );
  });
});

// ─── Integration: generate-commands pipeline wiring ───

describe('generate-commands pipeline wiring', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  test('toolChoice flows through from caller to first API call', () => {
    // Simulate the exact wiring from +server.js:
    //   llmClient.toolCompletion(messages, tools, executeTool,
    //     { systemPrompt, maxIterations: 5, toolChoice: 'required' })
    mockCreate
      .mockResolvedValueOnce(
        makeToolCallResponse([
          { name: 'lookup_customers', args: {} },
        ]),
      )
      .mockResolvedValueOnce(
        makeTextResponse(
          '{"commands":[{"aggregateName":"customer","aggregateId":"new-1","command":"CREATE","payload":{"name":"Acme","location":"Berlin"}}]}',
        ),
      );

    const client = createLlmClient({
      apiKey: 'test-key',
      model: 'test-model',
    });

    // Mock executeTool to return customer data (like the real pipeline)
    const executeToolFn = (name) =>
      name === 'lookup_customers'
        ? Promise.resolve([
            { id: 'c1', name: 'Alice', location: 'Berlin' },
          ])
        : [];

    return client
      .toolCompletion(
        [{ role: 'user', content: 'Create a customer Acme in Berlin' }],
        genTools,
        executeToolFn,
        { systemPrompt: 'test prompt', maxIterations: 5, toolChoice: 'required' },
      )
      .then((result) => {
        // Verify tool_choice was passed on first call
        expect(mockCreate.mock.calls[0][0]).toHaveProperty(
          'tool_choice',
          'required',
        );
        // Verify second call has no tool_choice
        expect(mockCreate.mock.calls[1][0]).not.toHaveProperty(
          'tool_choice',
        );
        // Verify end-to-end: result contains the LLM content
        expect(result.content).toContain('"commands"');
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].name).toBe('lookup_customers');
      });
  });
});
