import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@lazyapps/logger', () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockJsonCompletion = vi.fn();

vi.mock('../llm.js', () => ({
  llmClient: {
    jsonCompletion: (...args) => mockJsonCompletion(...args),
  },
}));

const { trendAnalysisSideEffect, default: trendAnalysisReadModel } =
  await import('../readmodels/trendAnalysis.js');

describe('trendAnalysisSideEffect', () => {
  let storage;
  let commands;
  let changeNotification;

  beforeEach(() => {
    vi.clearAllMocks();

    const customerOrders = [
      { id: 'o1', text: 'Widget', value: 100, status: 'confirmed' },
      { id: 'o2', text: 'Gadget', value: 200, status: 'confirmed' },
      { id: 'o3', text: 'Doohickey', value: 300, status: 'confirmed' },
    ];

    const allOrders = [
      ...customerOrders,
      { id: 'o4', text: 'Other', value: 50, status: 'new', customerId: 'cust-2' },
    ];

    storage = {
      find: vi.fn().mockImplementation((collection, query) => ({
        toArray: vi.fn().mockResolvedValue(
          query.customerId ? customerOrders : allOrders,
        ),
      })),
      insertOne: vi.fn().mockResolvedValue(),
    };

    commands = {
      execute: vi.fn().mockReturnValue(() => Promise.resolve()),
    };

    changeNotification = {
      sendChangeNotification: vi.fn().mockResolvedValue(),
      createChangeInfo: vi
        .fn()
        .mockImplementation((...args) => ({ args })),
    };
  });

  test('returns a thunk (Pattern B)', () => {
    const result = trendAnalysisSideEffect(
      storage,
      commands,
      changeNotification,
      'cust-1',
      'Alice',
    );
    expect(typeof result).toBe('function');
  });

  test('skips analysis when order count below threshold', () => {
    storage.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { id: 'o1', text: 'Widget', value: 100 },
        { id: 'o2', text: 'Gadget', value: 200 },
      ]),
    });

    return trendAnalysisSideEffect(
      storage,
      commands,
      changeNotification,
      'cust-1',
      'Alice',
    )().then((result) => {
      expect(result).toBeNull();
      expect(mockJsonCompletion).not.toHaveBeenCalled();
      expect(commands.execute).not.toHaveBeenCalled();
    });
  });

  test('calls LLM and sends RECORD_TREND_ANALYSIS when threshold met', () => {
    const llmResult = {
      riskLevel: 'medium',
      issues: [{ type: 'velocity', description: 'Fast ordering' }],
      summary: 'Moderate risk',
    };
    mockJsonCompletion.mockResolvedValue({
      content: llmResult,
    });

    return trendAnalysisSideEffect(
      storage,
      commands,
      changeNotification,
      'cust-1',
      'Alice',
    )().then(() => {
      // Verify LLM was called with system prompt
      expect(mockJsonCompletion).toHaveBeenCalledOnce();
      const [messages, opts] = mockJsonCompletion.mock.calls[0];
      expect(messages[0].role).toBe('user');
      expect(opts.systemPrompt).toContain('risk assessment');
      expect(opts.systemPrompt).toContain('Alice');

      // Verify RECORD_TREND_ANALYSIS command
      expect(commands.execute).toHaveBeenCalledOnce();
      expect(commands.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateName: 'customer',
          aggregateId: 'cust-1',
          command: 'RECORD_TREND_ANALYSIS',
          payload: expect.objectContaining({
            analysisType: 'potential-issues',
            result: llmResult,
            customerName: 'Alice',
            orderCount: 3,
            trigger: 'event-driven',
          }),
        }),
      );
    });
  });

  test('payload includes all 5 required fields', () => {
    mockJsonCompletion.mockResolvedValue({
      content: { riskLevel: 'low', issues: [], summary: 'OK' },
    });

    return trendAnalysisSideEffect(
      storage,
      commands,
      changeNotification,
      'cust-1',
      'Alice',
    )().then(() => {
      const payload = commands.execute.mock.calls[0][0].payload;
      expect(payload).toHaveProperty('analysisType');
      expect(payload).toHaveProperty('result');
      expect(payload).toHaveProperty('customerName');
      expect(payload).toHaveProperty('orderCount');
      expect(payload).toHaveProperty('trigger');
    });
  });

  test('fetches both customer orders and all orders', () => {
    mockJsonCompletion.mockResolvedValue({
      content: { riskLevel: 'low', issues: [], summary: 'OK' },
    });

    return trendAnalysisSideEffect(
      storage,
      commands,
      changeNotification,
      'cust-1',
      'Alice',
    )().then(() => {
      // Should call find twice: once for customer orders, once for all
      expect(storage.find).toHaveBeenCalledWith('orders_overview', {
        customerId: 'cust-1',
      });
      expect(storage.find).toHaveBeenCalledWith('orders_overview', {});
    });
  });

  test('returns null on LLM parse error', () => {
    mockJsonCompletion.mockResolvedValue({
      error: 'Invalid JSON from LLM',
      content: null,
    });

    return trendAnalysisSideEffect(
      storage,
      commands,
      changeNotification,
      'cust-1',
      'Alice',
    )().then((result) => {
      expect(result).toBeNull();
      expect(commands.execute).not.toHaveBeenCalled();
    });
  });
});

describe('trendAnalysis read model projections', () => {
  describe('CUSTOMER_TREND_ANALYZED', () => {
    const projection =
      trendAnalysisReadModel.projections.CUSTOMER_TREND_ANALYZED;

    test('stores analysis record and sends change notification', () => {
      const insertedDocs = [];
      const storage = {
        insertOne: vi.fn().mockImplementation((collection, doc) => {
          insertedDocs.push({ collection, doc });
          return Promise.resolve();
        }),
      };
      const sendChangeNotification = vi.fn().mockResolvedValue();
      const createChangeInfo = vi
        .fn()
        .mockImplementation((...args) => ({ args }));

      const event = {
        aggregateId: 'cust-1',
        payload: {
          customerName: 'Alice',
          analysisType: 'potential-issues',
          result: { riskLevel: 'low', issues: [], summary: 'OK' },
          orderCount: 5,
          trigger: 'event-driven',
        },
        timestamp: '2026-01-01T00:00:00.000Z',
      };

      return projection(
        {
          storage,
          changeNotification: { sendChangeNotification, createChangeInfo },
        },
        event,
      ).then(() => {
        expect(storage.insertOne).toHaveBeenCalledOnce();
        expect(insertedDocs[0].collection).toBe('orders_trend_analysis');
        expect(insertedDocs[0].doc).toEqual({
          customerId: 'cust-1',
          customerName: 'Alice',
          analysisType: 'potential-issues',
          result: { riskLevel: 'low', issues: [], summary: 'OK' },
          orderCount: 5,
          trigger: 'event-driven',
          timestamp: '2026-01-01T00:00:00.000Z',
        });

        expect(sendChangeNotification).toHaveBeenCalledOnce();
        expect(createChangeInfo).toHaveBeenCalledWith(
          'orders',
          'trendAnalysis',
          'all',
          'addRow',
          expect.objectContaining({
            customerId: 'cust-1',
            analysisType: 'potential-issues',
          }),
        );
      });
    });

    test('uses generated timestamp when event has no timestamp', () => {
      const storage = {
        insertOne: vi.fn().mockResolvedValue(),
      };
      const sendChangeNotification = vi.fn().mockResolvedValue();
      const createChangeInfo = vi.fn().mockReturnValue({});

      const event = {
        aggregateId: 'cust-2',
        payload: {
          customerName: 'Bob',
          analysisType: 'potential-issues',
          result: {},
          orderCount: 3,
          trigger: 'event-driven',
        },
      };

      return projection(
        {
          storage,
          changeNotification: { sendChangeNotification, createChangeInfo },
        },
        event,
      ).then(() => {
        const doc = storage.insertOne.mock.calls[0][1];
        expect(doc.timestamp).toBeDefined();
        expect(typeof doc.timestamp).toBe('string');
      });
    });
  });
});
