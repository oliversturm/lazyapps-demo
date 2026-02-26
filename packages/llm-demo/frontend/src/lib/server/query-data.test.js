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

    test('filters by customerId when provided', () => {
      const allOrders = [
        { id: 'o1', customerId: 'c1', text: 'Widget', value: 100, status: 'confirmed' },
        { id: 'o2', customerId: 'c2', text: 'Gadget', value: 200, status: 'new' },
        { id: 'o3', customerId: 'c1', text: 'Gizmo', value: 50, status: 'confirmed' },
      ];
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve(allOrders),
      });
      return executeTool('query_orders', { customerId: 'c1' }).then(
        (result) => {
          expect(result).toHaveLength(2);
          result.forEach((o) => expect(o.customerId).toBe('c1'));
        },
      );
    });

    test('returns empty for non-existent customerId', () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve([]),
      });
      return executeTool('query_orders', { customerId: 'nonexistent' }).then(
        (result) => {
          expect(result).toEqual([]);
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
});
