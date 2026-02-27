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

const {
  trendAnalysisSideEffect,
  trendReanalysisSideEffect,
  default: trendAnalysisReadModel,
  __testing__,
} = await import('../readmodels/trendAnalysis.js');

const { validateRiskScore } = __testing__;

describe('trendAnalysisSideEffect', () => {
  let storage;
  let commands;

  beforeEach(() => {
    vi.clearAllMocks();

    const customerOrders = [
      { id: 'o1', text: 'Widget', value: 100, status: 'confirmed' },
      { id: 'o2', text: 'Gadget', value: 200, status: 'confirmed' },
      { id: 'o3', text: 'Doohickey', value: 300, status: 'confirmed' },
    ];

    const allOrders = [
      ...customerOrders,
      {
        id: 'o4',
        text: 'Other',
        value: 50,
        status: 'new',
        customerId: 'cust-2',
      },
    ];

    storage = {
      find: vi.fn().mockImplementation((collection, query) => ({
        toArray: vi
          .fn()
          .mockResolvedValue(query.customerId ? customerOrders : allOrders),
      })),
      insertOne: vi.fn().mockResolvedValue(),
    };

    commands = {
      execute: vi.fn().mockReturnValue(() => Promise.resolve()),
    };
  });

  test('returns a thunk (Pattern B)', () => {
    const result = trendAnalysisSideEffect(
      storage,
      commands,
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
            result: { ...llmResult, riskScore: null },
            customerName: 'Alice',
            orderCount: 3,
            trigger: 'ORDER_CREATED',
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
      'cust-1',
      'Alice',
    )().then((result) => {
      expect(result).toBeNull();
      expect(commands.execute).not.toHaveBeenCalled();
    });
  });

  test('validates and includes riskScore in payload', () => {
    mockJsonCompletion.mockResolvedValue({
      content: {
        riskLevel: 'high',
        riskScore: 78,
        issues: [],
        summary: 'High risk',
      },
    });

    return trendAnalysisSideEffect(
      storage,
      commands,
      'cust-1',
      'Alice',
    )().then(() => {
      const payload = commands.execute.mock.calls[0][0].payload;
      expect(payload.result.riskScore).toBe(78);
    });
  });
});

describe('trendReanalysisSideEffect', () => {
  let commands;

  const makeReanalysisStorage = ({
    orderData = null,
    customerOrders = [],
    allOrders = null,
  } = {}) => ({
    find: vi.fn().mockImplementation((collection, query) => {
      if (query.id) {
        // Order lookup by aggregateId
        return {
          toArray: vi
            .fn()
            .mockResolvedValue(orderData ? [orderData] : []),
        };
      }
      if (query.customerId) {
        // Customer orders lookup
        return {
          toArray: vi.fn().mockResolvedValue(customerOrders),
        };
      }
      // All orders lookup
      return {
        toArray: vi.fn().mockResolvedValue(allOrders || [...customerOrders]),
      };
    }),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    commands = {
      execute: vi.fn().mockReturnValue(() => Promise.resolve()),
    };
  });

  test('returns a thunk (Pattern B)', () => {
    const storage = makeReanalysisStorage();
    const result = trendReanalysisSideEffect(
      storage,
      commands,
      'order-1',
      'ORDER_CONFIRMED',
    );
    expect(typeof result).toBe('function');
  });

  test('looks up order from orders_overview by aggregateId', () => {
    const orderData = {
      id: 'order-1',
      customerId: 'cust-1',
      customerName: 'Alice',
    };
    const customerOrders = [
      { id: 'o1', text: 'Widget', value: 100, status: 'confirmed' },
      { id: 'o2', text: 'Gadget', value: 200, status: 'confirmed' },
      { id: 'o3', text: 'Doohickey', value: 300, status: 'confirmed' },
    ];
    const storage = makeReanalysisStorage({
      orderData,
      customerOrders,
    });
    mockJsonCompletion.mockResolvedValue({
      content: { riskLevel: 'low', riskScore: 20, issues: [], summary: 'OK' },
    });

    return trendReanalysisSideEffect(
      storage,
      commands,
      'order-1',
      'ORDER_CONFIRMED',
    )().then(() => {
      // First call: order lookup by id
      expect(storage.find).toHaveBeenCalledWith('orders_overview', {
        id: 'order-1',
      });
    });
  });

  test('calls runTrendAnalysis with correct customerId and customerName', () => {
    const orderData = {
      id: 'order-1',
      customerId: 'cust-1',
      customerName: 'Alice',
    };
    const customerOrders = [
      { id: 'o1', text: 'Widget', value: 100, status: 'confirmed' },
      { id: 'o2', text: 'Gadget', value: 200, status: 'confirmed' },
      { id: 'o3', text: 'Doohickey', value: 300, status: 'confirmed' },
    ];
    const storage = makeReanalysisStorage({
      orderData,
      customerOrders,
    });
    mockJsonCompletion.mockResolvedValue({
      content: { riskLevel: 'low', riskScore: 20, issues: [], summary: 'OK' },
    });

    return trendReanalysisSideEffect(
      storage,
      commands,
      'order-1',
      'ORDER_CONFIRMED',
    )().then(() => {
      // Verify LLM was called (proves runTrendAnalysis ran)
      expect(mockJsonCompletion).toHaveBeenCalledOnce();
      const [, opts] = mockJsonCompletion.mock.calls[0];
      expect(opts.systemPrompt).toContain('Alice');

      // Verify command was issued for the correct customer
      expect(commands.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateName: 'customer',
          aggregateId: 'cust-1',
          command: 'RECORD_TREND_ANALYSIS',
          payload: expect.objectContaining({
            customerName: 'Alice',
          }),
        }),
      );
    });
  });

  test('returns early with warning when order not found', () => {
    const storage = makeReanalysisStorage({ orderData: null });

    return trendReanalysisSideEffect(
      storage,
      commands,
      'nonexistent-order',
      'ORDER_CONFIRMED',
    )().then(() => {
      expect(mockJsonCompletion).not.toHaveBeenCalled();
      expect(commands.execute).not.toHaveBeenCalled();
    });
  });

  test('respects ANALYSIS_THRESHOLD', () => {
    const orderData = {
      id: 'order-1',
      customerId: 'cust-1',
      customerName: 'Alice',
    };
    // Only 2 orders — below threshold of 3
    const customerOrders = [
      { id: 'o1', text: 'Widget', value: 100, status: 'confirmed' },
      { id: 'o2', text: 'Gadget', value: 200, status: 'confirmed' },
    ];
    const storage = makeReanalysisStorage({
      orderData,
      customerOrders,
    });

    return trendReanalysisSideEffect(
      storage,
      commands,
      'order-1',
      'ORDER_CONFIRMED',
    )().then((result) => {
      expect(result).toBeNull();
      expect(mockJsonCompletion).not.toHaveBeenCalled();
      expect(commands.execute).not.toHaveBeenCalled();
    });
  });

  test('passes ORDER_CONFIRMED as trigger', () => {
    const orderData = {
      id: 'order-1',
      customerId: 'cust-1',
      customerName: 'Alice',
    };
    const customerOrders = [
      { id: 'o1', text: 'Widget', value: 100, status: 'confirmed' },
      { id: 'o2', text: 'Gadget', value: 200, status: 'confirmed' },
      { id: 'o3', text: 'Doohickey', value: 300, status: 'confirmed' },
    ];
    const storage = makeReanalysisStorage({
      orderData,
      customerOrders,
    });
    mockJsonCompletion.mockResolvedValue({
      content: { riskLevel: 'low', riskScore: 25, issues: [], summary: 'OK' },
    });

    return trendReanalysisSideEffect(
      storage,
      commands,
      'order-1',
      'ORDER_CONFIRMED',
    )().then(() => {
      const payload = commands.execute.mock.calls[0][0].payload;
      expect(payload.trigger).toBe('ORDER_CONFIRMED');
    });
  });

  test('passes ORDER_DECLINED as trigger', () => {
    const orderData = {
      id: 'order-1',
      customerId: 'cust-1',
      customerName: 'Alice',
    };
    const customerOrders = [
      { id: 'o1', text: 'Widget', value: 100, status: 'confirmed' },
      { id: 'o2', text: 'Gadget', value: 200, status: 'declined' },
      { id: 'o3', text: 'Doohickey', value: 300, status: 'new' },
    ];
    const storage = makeReanalysisStorage({
      orderData,
      customerOrders,
    });
    mockJsonCompletion.mockResolvedValue({
      content: {
        riskLevel: 'medium',
        riskScore: 55,
        issues: [],
        summary: 'Moderate',
      },
    });

    return trendReanalysisSideEffect(
      storage,
      commands,
      'order-1',
      'ORDER_DECLINED',
    )().then(() => {
      const payload = commands.execute.mock.calls[0][0].payload;
      expect(payload.trigger).toBe('ORDER_DECLINED');
    });
  });
});

describe('validateRiskScore', () => {
  test('valid number in range returned as-is', () => {
    expect(validateRiskScore(50)).toBe(50);
    expect(validateRiskScore(0)).toBe(0);
    expect(validateRiskScore(100)).toBe(100);
  });

  test('number > 100 clamped to 100', () => {
    expect(validateRiskScore(150)).toBe(100);
    expect(validateRiskScore(999)).toBe(100);
  });

  test('number < 0 clamped to 0', () => {
    expect(validateRiskScore(-5)).toBe(0);
    expect(validateRiskScore(-100)).toBe(0);
  });

  test('non-number returns null', () => {
    expect(validateRiskScore('medium')).toBeNull();
    expect(validateRiskScore(undefined)).toBeNull();
    expect(validateRiskScore(null)).toBeNull();
  });

  test('NaN and Infinity return null', () => {
    expect(validateRiskScore(NaN)).toBeNull();
    expect(validateRiskScore(Infinity)).toBeNull();
    expect(validateRiskScore(-Infinity)).toBeNull();
  });

  test('float rounded to integer', () => {
    expect(validateRiskScore(55.7)).toBe(56);
    expect(validateRiskScore(55.3)).toBe(55);
    expect(validateRiskScore(0.4)).toBe(0);
    expect(validateRiskScore(99.5)).toBe(100);
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
          trigger: 'ORDER_CREATED',
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
          riskScore: null,
          orderCount: 5,
          trigger: 'ORDER_CREATED',
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
            riskScore: null,
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
          trigger: 'ORDER_CREATED',
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

    test('stores numeric riskScore as top-level field when present in result', () => {
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
          result: {
            riskLevel: 'high',
            riskScore: 78,
            issues: [],
            summary: 'High risk',
          },
          orderCount: 5,
          trigger: 'ORDER_CONFIRMED',
        },
        timestamp: '2026-01-15T12:00:00.000Z',
      };

      return projection(
        {
          storage,
          changeNotification: { sendChangeNotification, createChangeInfo },
        },
        event,
      ).then(() => {
        expect(insertedDocs[0].doc.riskScore).toBe(78);
      });
    });

    test('stores riskScore as null when missing from result', () => {
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
          trigger: 'ORDER_CREATED',
        },
        timestamp: '2026-01-15T12:00:00.000Z',
      };

      return projection(
        {
          storage,
          changeNotification: { sendChangeNotification, createChangeInfo },
        },
        event,
      ).then(() => {
        expect(insertedDocs[0].doc.riskScore).toBeNull();
      });
    });

    test('change notification includes riskScore', () => {
      const storage = {
        insertOne: vi.fn().mockResolvedValue(),
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
          result: {
            riskLevel: 'medium',
            riskScore: 55,
            issues: [],
            summary: 'Moderate',
          },
          orderCount: 4,
          trigger: 'ORDER_DECLINED',
        },
        timestamp: '2026-01-15T12:00:00.000Z',
      };

      return projection(
        {
          storage,
          changeNotification: { sendChangeNotification, createChangeInfo },
        },
        event,
      ).then(() => {
        expect(createChangeInfo).toHaveBeenCalledWith(
          'orders',
          'trendAnalysis',
          'all',
          'addRow',
          expect.objectContaining({
            riskScore: 55,
            trigger: 'ORDER_DECLINED',
          }),
        );
      });
    });
  });
});
