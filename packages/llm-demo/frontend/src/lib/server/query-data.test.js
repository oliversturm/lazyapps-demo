import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { tools, executeTool, systemPrompt } from './query-data.js';

// ─── Tool definitions ───

describe('tools', () => {
  test('defines three tools', () => {
    expect(tools).toHaveLength(3);
    expect(tools[0].function.name).toBe('query_customers');
    expect(tools[1].function.name).toBe('query_orders');
    expect(tools[2].function.name).toBe('query_order_stats');
  });

  test('query_customers has no required parameters', () => {
    const params = tools[0].function.parameters;
    expect(params.required).toEqual([]);
  });

  test('query_customers description mentions locations', () => {
    expect(tools[0].function.description).toContain('location');
  });

  test('query_orders accepts optional customerId parameter', () => {
    const params = tools[1].function.parameters;
    expect(params.properties).toHaveProperty('customerId');
    expect(params.properties.customerId.type).toBe('string');
    expect(params.required).toEqual([]);
  });

  test('query_orders customerId does not suggest an ID format like UUID', () => {
    const desc = tools[1].function.parameters.properties.customerId.description;
    expect(desc).not.toMatch(/uuid|guid/i);
  });

  test('query_orders customerId must be copied from tool results, never constructed', () => {
    const desc = tools[1].function.parameters.properties.customerId.description;
    expect(desc).toContain('copied exactly');
    expect(desc).toContain('query_customers');
    expect(desc).toContain('never construct, guess or reformat');
  });

  test('query_orders description mentions item description and value', () => {
    const desc = tools[1].function.description;
    expect(desc).toContain('item description');
    expect(desc).toContain('value');
    expect(desc).toContain('status');
  });

  test('query_order_stats has no required parameters', () => {
    const params = tools[2].function.parameters;
    expect(params.required).toEqual([]);
  });

  test('query_order_stats description mentions statistics', () => {
    const desc = tools[2].function.description;
    expect(desc).toContain('total count');
    expect(desc).toContain('average');
    expect(desc).toContain('status');
  });

  test('query_order_stats description mentions top customers with customerId', () => {
    const desc = tools[2].function.description;
    expect(desc).toContain('top customers');
    expect(desc).toContain('customerId');
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

  describe('query_customers', () => {
    test('fetches from llm_lookup/all endpoint', () => {
      const customers = [
        { id: 'c1', name: 'Alice', location: 'Berlin' },
        { id: 'c2', name: 'Bob', location: 'London' },
      ];
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve(customers),
      });
      return executeTool('query_customers', {}).then((result) => {
        expect(result).toEqual(customers);
        expect(mockFetch).toHaveBeenCalledWith(
          'http://readmodel-customers/query/llm_lookup/all',
          expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      });
    });

    test('does NOT use overview/all endpoint', () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve([]),
      });
      return executeTool('query_customers', {}).then(() => {
        const url = mockFetch.mock.calls[0][0];
        expect(url).not.toContain('overview/all');
        expect(url).toContain('llm_lookup/all');
      });
    });
  });

  describe('query_orders', () => {
    test('fetches all orders when no customerId provided', () => {
      const orders = [
        { id: 'o1', customerId: 'c1', text: 'Widget', value: 100, status: 'confirmed' },
      ];
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve(orders),
      });
      return executeTool('query_orders', {}).then((result) => {
        expect(result).toEqual(orders);
        expect(mockFetch).toHaveBeenCalledWith(
          'http://readmodel-orders/query/overview/all',
          expect.objectContaining({ method: 'POST' }),
        );
      });
    });

    // Routes mocked fetch calls by URL, so customer lookups and order
    // queries can return different data within the same tool call.
    const mockReadModels = ({ customers = [], orders = [] }) =>
      mockFetch.mockImplementation((url) =>
        Promise.resolve({
          json: () =>
            Promise.resolve(
              url.includes('llm_lookup')
                ? customers
                : url.includes('overview')
                  ? orders
                  : [],
            ),
        }),
      );

    const customers = [
      { id: 'c1', name: 'Alice', location: 'Berlin' },
      { id: 'c2', name: 'Bob', location: 'London' },
      { id: 'c3', name: 'Carol', location: 'Paris' },
    ];

    test('filters by customerId when provided', () => {
      mockReadModels({
        customers,
        orders: [
          { id: 'o1', customerId: 'c1', text: 'Widget', value: 100, status: 'confirmed' },
          { id: 'o2', customerId: 'c2', text: 'Gadget', value: 200, status: 'new' },
          { id: 'o3', customerId: 'c1', text: 'Gizmo', value: 50, status: 'confirmed' },
        ],
      });
      return executeTool('query_orders', { customerId: 'c1' }).then(
        (result) => {
          expect(result).toHaveLength(2);
          result.forEach((o) => expect(o.customerId).toBe('c1'));
        },
      );
    });

    test('returns empty array for a known customer without orders', () => {
      mockReadModels({
        customers,
        orders: [
          { id: 'o1', customerId: 'c1', text: 'Widget', value: 100, status: 'confirmed' },
        ],
      });
      return executeTool('query_orders', { customerId: 'c3' }).then(
        (result) => {
          expect(result).toEqual([]);
        },
      );
    });

    test('returns an error (not an empty list) for an unknown customerId', () => {
      // Regression: the model invented a UUID-shaped ID, got [] back and
      // told the user the customer had no orders.
      const madeUpId = '3f2b8c1e-9a4d-4e6f-8b2a-1c5d7e9f0a3b';
      mockReadModels({
        customers,
        orders: [
          { id: 'o1', customerId: 'c1', text: 'Widget', value: 100, status: 'confirmed' },
        ],
      });
      return executeTool('query_orders', { customerId: madeUpId }).then(
        (result) => {
          expect(Array.isArray(result)).toBe(false);
          expect(result.error).toContain(madeUpId);
          expect(result.error).toContain('Unknown customerId');
          expect(result.error).toContain('query_customers');
        },
      );
    });
  });

  describe('query_order_stats', () => {
    test('fetches orders and computes stats', () => {
      const orders = [
        { value: 100, status: 'confirmed', customerName: 'Alice' },
        { value: 200, status: 'new', customerName: 'Bob' },
      ];
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve(orders),
      });
      return executeTool('query_order_stats', {}).then((result) => {
        expect(result).toHaveProperty('totalOrders', 2);
        expect(result).toHaveProperty('totalValue', 300);
        expect(result).toHaveProperty('averageValue', 150);
        expect(result).toHaveProperty('byStatus');
        expect(result).toHaveProperty('topCustomers');
      });
    });

    test('topCustomers include the customerId', () => {
      const orders = [
        { value: 8500, status: 'confirmed', customerId: 'customer-03', customerName: 'Global Logistics AG' },
        { value: 450, status: 'confirmed', customerId: 'customer-01', customerName: 'Alice' },
      ];
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve(orders),
      });
      return executeTool('query_order_stats', {}).then((result) => {
        expect(result.topCustomers[0]).toMatchObject({
          customerId: 'customer-03',
          name: 'Global Logistics AG',
        });
      });
    });
  });

  describe('unknown tool', () => {
    test('returns error for unknown tool name', () => {
      return executeTool('unknown_tool', {}).then((result) => {
        expect(result).toEqual({ error: 'Unknown tool: unknown_tool' });
      });
    });
  });
});

// ─── System prompt ───

describe('systemPrompt', () => {
  test('includes customer service assistant identifier', () => {
    expect(systemPrompt).toContain('customer service assistant');
  });

  test('includes analytical authorization', () => {
    expect(systemPrompt).toContain('authorized to ANALYZE');
  });

  test('includes business insights authorization', () => {
    expect(systemPrompt).toContain('business insights');
  });

  test('includes both direct queries and analytical questions', () => {
    expect(systemPrompt).toContain('direct data queries');
    expect(systemPrompt).toContain('analytical/advisory');
  });

  test('documents all three tools', () => {
    expect(systemPrompt).toContain('query_customers');
    expect(systemPrompt).toContain('query_orders');
    expect(systemPrompt).toContain('query_order_stats');
  });

  test('documents query_customers returns location data', () => {
    expect(systemPrompt).toContain('location');
  });

  test('documents order fields including text (product description)', () => {
    expect(systemPrompt).toContain('text (product description)');
  });

  test('includes analytical reasoning examples', () => {
    expect(systemPrompt).toContain('EXAMPLES OF ANALYTICAL REASONING');
  });

  test('includes product suggestion example', () => {
    expect(systemPrompt).toContain('What products should we sell');
  });

  test('includes customer value analysis example', () => {
    expect(systemPrompt).toContain('most valuable customers');
  });

  test('includes trend analysis example', () => {
    expect(systemPrompt).toContain('What trends do you see');
  });

  test('instructs to analyze data rather than refuse', () => {
    expect(systemPrompt).toContain(
      'If you have ANY data that relates to the question, analyze it',
    );
  });

  test('instructs that analysis of real data IS a valid answer', () => {
    expect(systemPrompt).toContain('Your analysis of real data IS a valid answer');
  });

  test('includes formatting instructions for currency', () => {
    expect(systemPrompt).toContain('$1,234.56');
  });

  test('includes instruction for bullet points or tables', () => {
    expect(systemPrompt).toContain('bullet points or tables');
  });

  test('forbids constructing or guessing IDs', () => {
    expect(systemPrompt).toContain('Never construct, guess or reformat an ID');
  });

  test('instructs to look up the ID again when only the name is known', () => {
    expect(systemPrompt).toContain(
      'call query_customers to look up their ID first',
    );
  });

  test('does not mention UUIDs', () => {
    expect(systemPrompt).not.toMatch(/uuid|guid/i);
  });

  test('points the most valuable customers example at topCustomers with IDs', () => {
    expect(systemPrompt).toContain('topCustomers');
  });
});
