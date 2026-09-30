import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Full-flow test of the customer service chat endpoint: real endpoint, real
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

// ─── Seed-like read model data ───

const customers = [
  { id: 'customer-01', name: 'Müller Büromöbel GmbH', location: 'Munich' },
  { id: 'customer-02', name: 'TechStart Berlin', location: 'Berlin' },
  { id: 'customer-03', name: 'Global Logistics AG', location: 'Hamburg' },
];

const orders = [
  { id: 'o1', customerId: 'customer-01', customerName: 'Müller Büromöbel GmbH', text: 'Office Desks (x10)', value: 450, status: 'confirmed' },
  { id: 'o2', customerId: 'customer-02', customerName: 'TechStart Berlin', text: 'Development Laptops (x3)', value: 4500, status: 'confirmed' },
  { id: 'o3', customerId: 'customer-03', customerName: 'Global Logistics AG', text: 'Warehouse Shelving System', value: 8500, status: 'confirmed' },
  { id: 'o4', customerId: 'customer-03', customerName: 'Global Logistics AG', text: 'Forklift Rental (3 months)', value: 3200, status: 'confirmed' },
];

// ─── Fake model ───

const toolCallResponse = (id, name, args) => ({
  usage: { total_tokens: 10 },
  choices: [
    {
      finish_reason: 'tool_calls',
      message: {
        content: null,
        tool_calls: [
          {
            id,
            type: 'function',
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      },
    },
  ],
});

const textResponse = (content) => ({
  usage: { total_tokens: 10 },
  choices: [{ finish_reason: 'stop', message: { content } }],
});

// Behaves like the real model did in the failing demo: when asked about
// "they", it uses the customer ID if one is visible in its context, and
// otherwise invents a UUID-shaped one.
const INVENTED_ID = '7c9e6679-7425-40de-944b-e07fc1f3b2a1';

const fakeModel = ({ messages }) => {
  const last = messages[messages.length - 1];

  if (last.role === 'user' && last.content.includes('best customer')) {
    return toolCallResponse('call_stats', 'query_order_stats', {});
  }
  if (last.role === 'tool' && last.tool_call_id === 'call_stats') {
    const stats = JSON.parse(last.content);
    return textResponse(
      `Your best customer is **${stats.topCustomers[0].name}**.`,
    );
  }
  if (last.role === 'user' && last.content.includes('what did they order')) {
    const context = messages
      .filter((m) => m.role === 'tool')
      .map((m) => m.content)
      .join('\n');
    const match = context.match(
      /"customerId":"([^"]+)","name":"Global Logistics AG"/,
    );
    return toolCallResponse('call_orders', 'query_orders', {
      customerId: match ? match[1] : INVENTED_ID,
    });
  }
  if (last.role === 'tool' && last.tool_call_id === 'call_orders') {
    const result = JSON.parse(last.content);
    return textResponse(
      Array.isArray(result) && result.length
        ? `They ordered: ${result.map((o) => o.text).join(', ')}`
        : 'Global Logistics AG has not placed any orders.',
    );
  }
  throw new Error(`fake model: unexpected state (last=${last.role})`);
};

// ─── Helpers ───

const post = (body) =>
  POST({
    request: new Request('http://localhost/api/llm/query-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  }).then((res) => res.json());

// Mirrors what the customer service page sends and keeps per turn
const ask = (text, conversationHistory) =>
  post({ messages: [{ role: 'user', content: text }], conversationHistory });

describe('customer service chat endpoint', () => {
  const originalFetch = globalThis.fetch;
  // Messages as sent on each API call. Snapshotted at call time because the
  // client keeps appending to the same array afterwards.
  let sentMessages;

  beforeEach(() => {
    sentMessages = [];
    mockCreate.mockReset();
    mockCreate.mockImplementation((params) => {
      const snapshot = structuredClone(params);
      sentMessages.push(snapshot.messages);
      return Promise.resolve(fakeModel(snapshot));
    });
    globalThis.fetch = vi.fn((url) =>
      Promise.resolve({
        json: () =>
          Promise.resolve(url.includes('llm_lookup') ? customers : orders),
      }),
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('follow-up question resolves "they" using the ID from the previous turn', async () => {
    const first = await ask("who's our best customer?", []);
    expect(first.content).toContain('Global Logistics AG');

    const second = await ask('what did they order?', first.conversationHistory);

    const ordersCall = second.toolCalls.find((tc) => tc.name === 'query_orders');
    expect(ordersCall.args.customerId).toBe('customer-03');
    expect(ordersCall.result).toHaveLength(2);
    expect(second.content).toContain('Warehouse Shelving System');
  });

  test('returned history contains the full turn including tool data', async () => {
    const first = await ask("who's our best customer?", []);

    expect(first.conversationHistory.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(first.conversationHistory[0]).toEqual({
      role: 'user',
      content: "who's our best customer?",
    });
    expect(first.conversationHistory[2].content).toContain('customer-03');
  });

  test('history sent to the model on a follow-up has tool results after their tool calls', async () => {
    const first = await ask("who's our best customer?", []);
    await ask('what did they order?', first.conversationHistory);

    // First API call of turn 2
    const sent = sentMessages[2];
    expect(sent[0].role).toBe('system');
    expect(sent[1]).toEqual({
      role: 'user',
      content: "who's our best customer?",
    });
    sent.forEach((m, i) => {
      if (m.role === 'tool') {
        expect(sent[i - 1].tool_calls.map((tc) => tc.id)).toContain(
          m.tool_call_id,
        );
      }
    });
    expect(sent[sent.length - 1]).toEqual({
      role: 'user',
      content: 'what did they order?',
    });
  });

  test('an invented customer ID yields an error for the model, not an empty order list', async () => {
    // No history: the fake model has no ID in context and invents one
    await ask('what did they order?', []);

    const toolMessage = sentMessages[1].find(
      (m) => m.role === 'tool',
    );
    const result = JSON.parse(toolMessage.content);
    expect(Array.isArray(result)).toBe(false);
    expect(result.error).toContain(INVENTED_ID);
    expect(result.error).toContain('query_customers');
  });

  test('history is capped at the last 10 turns, starting at a user message', async () => {
    const oldTurns = Array.from({ length: 12 }, (_, i) => [
      { role: 'user', content: `old question ${i + 1}` },
      { role: 'assistant', content: `old answer ${i + 1}` },
    ]).flat();

    const result = await ask("who's our best customer?", oldTurns);

    const sent = sentMessages[0];
    // system + 10 old turns (2 messages each) + current question
    expect(sent).toHaveLength(1 + 20 + 1);
    expect(sent[1]).toEqual({ role: 'user', content: 'old question 3' });

    const returnedUsers = result.conversationHistory.filter(
      (m) => m.role === 'user',
    );
    expect(returnedUsers).toHaveLength(10);
    expect(returnedUsers[0].content).toBe('old question 4');
    expect(returnedUsers[9].content).toBe("who's our best customer?");
  });
});
