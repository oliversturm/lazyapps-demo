import { describe, test, expect } from 'vitest';
import { createMockClient } from './mock-client.js';
import { tools } from './query-data.js';

describe('mock toolCompletion (query-data route)', () => {
  const executeTool = (name) =>
    Promise.resolve(
      name === 'query_customers'
        ? [{ id: 'customer-03', name: 'Global Logistics AG' }]
        : [],
    );

  test('returns a transcript with tool calls, tool results and final answer', () => {
    const client = createMockClient();
    return client
      .toolCompletion(
        [{ role: 'user', content: "who's our best customer?" }],
        tools,
        executeTool,
        { systemPrompt: 'You are a customer service assistant' },
      )
      .then((result) => {
        const [assistantCall, ...rest] = result.messages;
        expect(assistantCall.role).toBe('assistant');
        expect(assistantCall.tool_calls.length).toBeGreaterThan(0);

        const toolMessages = rest.filter((m) => m.role === 'tool');
        expect(toolMessages).toHaveLength(assistantCall.tool_calls.length);
        toolMessages.forEach((m, i) =>
          expect(m.tool_call_id).toBe(assistantCall.tool_calls[i].id),
        );
        expect(toolMessages[0].content).toContain('customer-03');

        expect(result.messages[result.messages.length - 1]).toEqual({
          role: 'assistant',
          content: result.content,
        });
      });
  });

  test('tool call names and args in the transcript match reported toolCalls', () => {
    const client = createMockClient();
    return client
      .toolCompletion(
        [{ role: 'user', content: 'show me all orders' }],
        tools,
        executeTool,
        { systemPrompt: 'You are a customer service assistant' },
      )
      .then((result) => {
        const calls = result.messages[0].tool_calls;
        expect(calls.map((c) => c.function.name)).toEqual(
          result.toolCalls.map((tc) => tc.name),
        );
        calls.forEach((c, i) =>
          expect(JSON.parse(c.function.arguments)).toEqual(
            result.toolCalls[i].args,
          ),
        );
      });
  });
});
