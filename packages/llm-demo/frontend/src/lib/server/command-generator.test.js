import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  tools,
  executeTool,
  systemPrompt,
  extractJson,
  parseResponse,
  transformCommands,
  MAX_COMMANDS,
} from './command-generator.js';

// ─── Tool definitions ───

describe('tools', () => {
  test('defines lookup_customers and lookup_orders', () => {
    expect(tools).toHaveLength(2);
    expect(tools[0].function.name).toBe('lookup_customers');
    expect(tools[1].function.name).toBe('lookup_orders');
  });

  test('lookup_customers accepts optional query parameter', () => {
    const params = tools[0].function.parameters;
    expect(params.properties).toHaveProperty('query');
    expect(params.properties.query.type).toBe('string');
    expect(params.required).toEqual([]);
  });

  test('lookup_customers description mentions fuzzy matching', () => {
    expect(tools[0].function.description).toContain('fuzzy matching');
  });

  test('lookup_orders accepts optional customerId parameter', () => {
    const params = tools[1].function.parameters;
    expect(params.properties).toHaveProperty('customerId');
    expect(params.required).toEqual([]);
  });
});

// ─── Tool executor ───

describe('executeTool', () => {
  const mockFetch = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mockFetch.mockReset();
  });

  const context = {
    orders: [
      {
        id: 'o1',
        customerId: 'c1',
        customerName: 'Alice',
        text: 'Widget',
        value: 100,
        status: 'confirmed',
        internalField: 'stripped',
      },
      {
        id: 'o2',
        customerId: 'c2',
        customerName: 'Bob',
        text: 'Gadget',
        value: 200,
        status: 'unconfirmed',
        internalField: 'stripped',
      },
      {
        id: 'o3',
        customerId: 'c1',
        customerName: 'Alice',
        text: 'Gizmo',
        value: 50,
        status: 'confirmed',
        internalField: 'stripped',
      },
    ],
  };

  describe('lookup_customers', () => {
    const allCustomers = [
      { id: 'c1', name: 'Alice', location: 'Berlin' },
      { id: 'c2', name: 'Bob', location: 'London' },
    ];

    test('fetches all customers when no query provided', () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve(allCustomers),
      });
      return executeTool('lookup_customers', {}, context).then((result) => {
        expect(result).toEqual(allCustomers);
        expect(mockFetch).toHaveBeenCalledWith(
          'http://readmodel-customers/query/llm_lookup/all',
          expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      });
    });

    test('fetches with search query when query provided', () => {
      const searchResults = [
        { id: 'c1', name: 'Alice', location: 'Berlin', score: 0.1 },
      ];
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve(searchResults),
      });
      return executeTool('lookup_customers', { query: 'Ali' }, context).then(
        (result) => {
          expect(result).toEqual(searchResults);
          expect(mockFetch).toHaveBeenCalledWith(
            'http://readmodel-customers/query/llm_lookup/search',
            expect.objectContaining({
              method: 'POST',
              body: JSON.stringify({ query: 'Ali' }),
            }),
          );
        },
      );
    });

    test('returns a Promise', () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve([]),
      });
      const result = executeTool('lookup_customers', {}, context);
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('lookup_orders', () => {
    test('returns all orders with selected fields', () => {
      const result = executeTool('lookup_orders', {}, context);
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        id: 'o1',
        customerId: 'c1',
        customerName: 'Alice',
        text: 'Widget',
        value: 100,
        status: 'confirmed',
      });
    });

    test('strips internal fields', () => {
      const result = executeTool('lookup_orders', {}, context);
      result.forEach((o) => {
        expect(o).not.toHaveProperty('internalField');
      });
    });

    test('filters by customerId when provided', () => {
      const result = executeTool(
        'lookup_orders',
        { customerId: 'c1' },
        context,
      );
      expect(result).toHaveLength(2);
      result.forEach((o) => expect(o.customerId).toBe('c1'));
    });

    test('returns empty for non-existent customerId', () => {
      const result = executeTool(
        'lookup_orders',
        { customerId: 'nonexistent' },
        context,
      );
      expect(result).toEqual([]);
    });

    test('returns empty array when no orders', () => {
      expect(executeTool('lookup_orders', {}, {})).toEqual([]);
    });
  });

  describe('unknown tool', () => {
    test('returns error for unknown tool name', () => {
      const result = executeTool('unknown_tool', {}, context);
      expect(result).toEqual({ error: 'Unknown tool: unknown_tool' });
    });
  });
});

// ─── JSON extraction ───

describe('extractJson', () => {
  test('parses raw JSON string', () => {
    const input = '{"commands": [{"command": "CREATE"}]}';
    expect(extractJson(input)).toEqual({
      commands: [{ command: 'CREATE' }],
    });
  });

  test('parses JSON with leading/trailing whitespace', () => {
    const input = '  \n{"commands": []}  \n';
    expect(extractJson(input)).toEqual({ commands: [] });
  });

  test('extracts JSON from ```json code block', () => {
    const input = '```json\n{"commands": [{"command": "CREATE"}]}\n```';
    expect(extractJson(input)).toEqual({
      commands: [{ command: 'CREATE' }],
    });
  });

  test('extracts JSON from ``` code block without language tag', () => {
    const input = '```\n{"commands": [{"command": "CREATE"}]}\n```';
    expect(extractJson(input)).toEqual({
      commands: [{ command: 'CREATE' }],
    });
  });

  test('extracts JSON from code block with surrounding text', () => {
    const input =
      'Here are the commands:\n```json\n{"commands": [{"command": "CREATE"}]}\n```\nDone.';
    expect(extractJson(input)).toEqual({
      commands: [{ command: 'CREATE' }],
    });
  });

  test('handles code block with extra whitespace', () => {
    const input = '```json\n  {"commands": []}  \n```';
    expect(extractJson(input)).toEqual({ commands: [] });
  });

  test('returns null for null input', () => {
    expect(extractJson(null)).toBeNull();
  });

  test('returns null for undefined input', () => {
    expect(extractJson(undefined)).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(extractJson('')).toBeNull();
  });

  test('returns null for non-string input', () => {
    expect(extractJson(42)).toBeNull();
  });

  test('returns null for plain text that is not JSON', () => {
    expect(extractJson('I cannot generate commands for this.')).toBeNull();
  });

  test('returns null for invalid JSON in code block', () => {
    expect(extractJson('```json\n{invalid}\n```')).toBeNull();
  });
});

// ─── Response parsing ───

describe('parseResponse', () => {
  test('parses valid JSON with commands', () => {
    const input = JSON.stringify({
      commands: [
        {
          aggregateName: 'customer',
          aggregateId: 'new-1',
          command: 'CREATE',
          payload: { name: 'Acme', location: 'Berlin' },
        },
      ],
    });
    const result = parseResponse(input);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].command).toBe('CREATE');
  });

  test('parses markdown-wrapped JSON', () => {
    const input =
      '```json\n{"commands": [{"aggregateName": "customer", "aggregateId": "new-1", "command": "CREATE", "payload": {"name": "Acme", "location": "Berlin"}}]}\n```';
    const result = parseResponse(input);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].payload.name).toBe('Acme');
  });

  test('returns explanation for unparseable text', () => {
    const input = 'I cannot determine what commands to generate.';
    const result = parseResponse(input);
    expect(result.commands).toEqual([]);
    expect(result.explanation).toBe(input);
  });

  test('returns explanation for null content', () => {
    const result = parseResponse(null);
    expect(result.commands).toEqual([]);
    expect(result.explanation).toBeNull();
  });

  test('preserves explanation field from LLM response', () => {
    const input = JSON.stringify({
      commands: [],
      explanation: 'Ambiguous request — please specify.',
    });
    const result = parseResponse(input);
    expect(result.commands).toEqual([]);
    expect(result.explanation).toBe('Ambiguous request — please specify.');
  });

  test('wraps bare JSON array as commands', () => {
    const input = JSON.stringify([
      {
        aggregateName: 'customer',
        aggregateId: 'new-1',
        command: 'CREATE',
        payload: { name: 'Acme', location: 'Berlin' },
      },
    ]);
    const result = parseResponse(input);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].command).toBe('CREATE');
  });

  test('wraps bare markdown-wrapped JSON array as commands', () => {
    const input =
      '```json\n[{"aggregateName": "customer", "aggregateId": "new-1", "command": "CREATE", "payload": {"name": "Acme", "location": "Berlin"}}]\n```';
    const result = parseResponse(input);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].payload.name).toBe('Acme');
  });

  test('handles JSON with only explanation, no commands key', () => {
    const input = JSON.stringify({
      explanation: 'Cannot map to commands',
    });
    const result = parseResponse(input);
    expect(result.commands).toBeUndefined();
    expect(result.explanation).toBe('Cannot map to commands');
  });
});

// ─── Command transformation ───

describe('transformCommands', () => {
  const mockId = () => 'generated-id';

  test('replaces aggregateId for CREATE commands', () => {
    const commands = [
      {
        aggregateName: 'customer',
        aggregateId: 'placeholder',
        command: 'CREATE',
        payload: { name: 'Acme', location: 'Berlin' },
      },
    ];
    const result = transformCommands(commands, mockId);
    expect(result[0].aggregateId).toBe('generated-id');
  });

  test('preserves aggregateId for non-CREATE commands', () => {
    const commands = [
      {
        aggregateName: 'customer',
        aggregateId: 'real-id-123',
        command: 'UPDATE',
        payload: { name: 'Acme', location: 'Berlin' },
      },
    ];
    const result = transformCommands(commands, mockId);
    expect(result[0].aggregateId).toBe('real-id-123');
  });

  test('coerces order CREATE value to number', () => {
    const commands = [
      {
        aggregateName: 'order',
        aggregateId: 'placeholder',
        command: 'CREATE',
        payload: { customerId: 'c1', text: 'Widget', value: '42.50' },
      },
    ];
    const result = transformCommands(commands, mockId);
    expect(result[0].payload.value).toBe(42.5);
    expect(typeof result[0].payload.value).toBe('number');
  });

  test('does not coerce value for non-order commands', () => {
    const commands = [
      {
        aggregateName: 'customer',
        aggregateId: 'placeholder',
        command: 'CREATE',
        payload: { name: 'Acme', location: 'Berlin' },
      },
    ];
    const result = transformCommands(commands, mockId);
    expect(result[0].payload).toEqual({ name: 'Acme', location: 'Berlin' });
  });

  test('does not coerce value for order CONFIRM', () => {
    const commands = [
      {
        aggregateName: 'order',
        aggregateId: 'order-1',
        command: 'CONFIRM',
        payload: {},
      },
    ];
    const result = transformCommands(commands, mockId);
    expect(result[0].payload).toEqual({});
    expect(result[0].aggregateId).toBe('order-1');
  });

  test('caps at MAX_COMMANDS', () => {
    const commands = Array.from({ length: 15 }, (_, i) => ({
      aggregateName: 'customer',
      aggregateId: `new-${i}`,
      command: 'CREATE',
      payload: { name: `Cust-${i}`, location: 'City' },
    }));
    const result = transformCommands(commands, mockId);
    expect(result).toHaveLength(MAX_COMMANDS);
  });

  test('returns empty array for non-array input', () => {
    expect(transformCommands(null, mockId)).toEqual([]);
    expect(transformCommands(undefined, mockId)).toEqual([]);
    expect(transformCommands('not an array', mockId)).toEqual([]);
    expect(transformCommands({}, mockId)).toEqual([]);
  });

  test('returns empty array for empty commands', () => {
    expect(transformCommands([], mockId)).toEqual([]);
  });

  test('handles multiple commands of different types', () => {
    const commands = [
      {
        aggregateName: 'customer',
        aggregateId: 'new-1',
        command: 'CREATE',
        payload: { name: 'Acme', location: 'Berlin' },
      },
      {
        aggregateName: 'order',
        aggregateId: 'new-2',
        command: 'CREATE',
        payload: { customerId: 'c1', text: 'Widget', value: '100' },
      },
      {
        aggregateName: 'order',
        aggregateId: 'order-1',
        command: 'CONFIRM',
        payload: {},
      },
    ];
    const result = transformCommands(commands, mockId);
    expect(result).toHaveLength(3);
    expect(result[0].aggregateId).toBe('generated-id');
    expect(result[1].aggregateId).toBe('generated-id');
    expect(result[1].payload.value).toBe(100);
    expect(result[2].aggregateId).toBe('order-1');
  });
});

// ─── System prompt ───

describe('systemPrompt', () => {
  test('includes command generator identifier', () => {
    expect(systemPrompt).toContain('command generator');
  });

  test('documents all aggregate types', () => {
    expect(systemPrompt).toContain('### customer');
    expect(systemPrompt).toContain('### order');
  });

  test('documents all command types', () => {
    expect(systemPrompt).toContain('CREATE');
    expect(systemPrompt).toContain('UPDATE');
    expect(systemPrompt).toContain('CONFIRM');
    expect(systemPrompt).toContain('DECLINE');
  });

  test('includes MAX_COMMANDS limit', () => {
    expect(systemPrompt).toContain(`Maximum ${MAX_COMMANDS} commands`);
  });

  test('instructs JSON response format', () => {
    expect(systemPrompt).toContain('"commands"');
  });

  // ── Strong role anchoring & refusal prevention ──

  test('includes strong role anchoring with EXCLUSIVELY', () => {
    expect(systemPrompt).toContain('EXCLUSIVELY');
  });

  test('includes refusal prevention with NEVER refuse', () => {
    expect(systemPrompt).toContain('NEVER refuse');
  });

  // ── Procedure section ──

  test('includes Procedure section', () => {
    expect(systemPrompt).toContain('## Procedure');
  });

  test('procedure step 1: lookup_customers first', () => {
    expect(systemPrompt).toContain('call lookup_customers FIRST');
  });

  test('procedure step 2: determine intended action', () => {
    expect(systemPrompt).toContain('Determine the intended action');
  });

  test('procedure step 3: invent reasonable product names', () => {
    expect(systemPrompt).toContain('invent reasonable product names');
  });

  test('procedure step 4: output JSON with commands array', () => {
    expect(systemPrompt).toContain(
      'Output a JSON object with a "commands" array',
    );
  });

  // ── Broader intent mapping examples ──

  test('includes intent example: top N items for Y', () => {
    expect(systemPrompt).toContain('wants the top N items for Y');
  });

  test('includes intent example: get X some Z', () => {
    expect(systemPrompt).toContain('"get X some Z"');
  });

  test('includes intent example: person + items/products/things/stuff', () => {
    expect(systemPrompt).toContain(
      'person + items/products/things/stuff',
    );
  });

  // ── Closing reminder ──

  test('includes closing reminder to always produce commands', () => {
    expect(systemPrompt).toContain(
      'Always produce commands. Never refuse.',
    );
  });
});

// ─── Integration: realistic LLM response scenarios ───

describe('end-to-end parsing scenarios', () => {
  const mockId = () => 'test-id';

  test('Mistral-style: JSON wrapped in markdown code block', () => {
    const llmContent = `Here are the generated commands:
\`\`\`json
{
  "commands": [
    {
      "aggregateName": "customer",
      "aggregateId": "new-1",
      "command": "CREATE",
      "payload": { "name": "TestCorp", "location": "Berlin" }
    }
  ]
}
\`\`\``;
    const parsed = parseResponse(llmContent);
    const commands = transformCommands(parsed.commands, mockId);
    expect(commands).toHaveLength(1);
    expect(commands[0].aggregateId).toBe('test-id');
    expect(commands[0].payload.name).toBe('TestCorp');
  });

  test('GPT-style: clean JSON response', () => {
    const llmContent =
      '{"commands":[{"aggregateName":"customer","aggregateId":"new-1","command":"CREATE","payload":{"name":"TestCorp","location":"Berlin"}}]}';
    const parsed = parseResponse(llmContent);
    const commands = transformCommands(parsed.commands, mockId);
    expect(commands).toHaveLength(1);
    expect(commands[0].payload.name).toBe('TestCorp');
  });

  test('LLM returns explanation instead of commands', () => {
    const llmContent =
      'I need more information. Which customer do you want to update?';
    const parsed = parseResponse(llmContent);
    const commands = transformCommands(parsed.commands, mockId);
    expect(commands).toEqual([]);
    expect(parsed.explanation).toContain('more information');
  });

  test('LLM returns null content (tool loop ended without text)', () => {
    const parsed = parseResponse(null);
    const commands = transformCommands(parsed.commands, mockId);
    expect(commands).toEqual([]);
  });

  test('order CREATE with string value gets coerced', () => {
    const llmContent = JSON.stringify({
      commands: [
        {
          aggregateName: 'order',
          aggregateId: 'new-1',
          command: 'CREATE',
          payload: { customerId: 'c1', text: 'Laptop', value: '1299.99' },
        },
      ],
    });
    const parsed = parseResponse(llmContent);
    const commands = transformCommands(parsed.commands, mockId);
    expect(commands[0].payload.value).toBe(1299.99);
    expect(typeof commands[0].payload.value).toBe('number');
  });

  test('multi-command response with mixed types', () => {
    const llmContent = JSON.stringify({
      commands: [
        {
          aggregateName: 'order',
          aggregateId: 'order-abc',
          command: 'CONFIRM',
          payload: {},
        },
        {
          aggregateName: 'order',
          aggregateId: 'order-def',
          command: 'CONFIRM',
          payload: {},
        },
      ],
    });
    const parsed = parseResponse(llmContent);
    const commands = transformCommands(parsed.commands, mockId);
    expect(commands).toHaveLength(2);
    expect(commands[0].aggregateId).toBe('order-abc');
    expect(commands[1].aggregateId).toBe('order-def');
  });
});
