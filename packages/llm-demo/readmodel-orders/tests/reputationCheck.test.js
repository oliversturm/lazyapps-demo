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

const { reputationCheckSideEffect, default: reputationCheckReadModel } =
  await import('../readmodels/reputationCheck.js');

// Helper: let fire-and-forget microtasks settle
const flushPromises = () => new Promise((r) => setTimeout(r, 0));

describe('reputationCheckSideEffect', () => {
  let storage;
  let commands;
  let changeNotification;
  let order;

  // storage.find is called with different collections:
  // - 'orders_reputation' for stored reputation lookup
  // - 'orders_overview' for order history (background LLM call)
  const makeFindMock = ({
    storedReputation = null,
    orderHistory = [
      { text: 'Widget', value: 100, status: 'confirmed' },
      { text: 'Gadget', value: 200, status: 'confirmed' },
    ],
  } = {}) =>
    vi.fn().mockImplementation((collection) => {
      if (collection === 'orders_reputation') {
        return {
          sort: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue(
                  storedReputation ? [{ reputation: storedReputation }] : [],
                ),
              }),
            }),
          }),
        };
      }
      // orders_overview — for background LLM call
      return {
        project: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue(orderHistory),
        }),
      };
    });

  beforeEach(() => {
    vi.clearAllMocks();

    storage = {
      find: makeFindMock(),
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

    order = {
      id: 'order-1',
      customerId: 'cust-1',
      customerName: 'Alice',
      value: 500,
    };
  });

  test('routes immediately via stored good reputation → CONFIRM', () => {
    storage.find = makeFindMock({ storedReputation: 'good' });

    return reputationCheckSideEffect(
      storage,
      commands,
      changeNotification,
      order,
    )().then(() => {
      // Order routed immediately to CONFIRM
      expect(commands.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateName: 'order',
          aggregateId: 'order-1',
          command: 'CONFIRM',
        }),
      );
    });
  });

  test('routes immediately via stored poor reputation → REQUIRE_CONFIRMATION', () => {
    storage.find = makeFindMock({ storedReputation: 'poor' });

    return reputationCheckSideEffect(
      storage,
      commands,
      changeNotification,
      order,
    )().then(() => {
      expect(commands.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateName: 'order',
          aggregateId: 'order-1',
          command: 'REQUIRE_CONFIRMATION',
        }),
      );
    });
  });

  test('routes via stored neutral reputation → value-based (STANDARD)', () => {
    storage.find = makeFindMock({ storedReputation: 'neutral' });
    order.value = 500; // under 1000 threshold → CONFIRM

    return reputationCheckSideEffect(
      storage,
      commands,
      changeNotification,
      order,
    )().then(() => {
      // STANDARD path goes through checkOrderValueSideEffect
      expect(commands.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateName: 'order',
          aggregateId: 'order-1',
          command: 'CONFIRM',
        }),
      );
    });
  });

  test('falls back to value-based routing when no stored reputation', () => {
    storage.find = makeFindMock({ storedReputation: null });
    order.value = 500; // under threshold → CONFIRM

    return reputationCheckSideEffect(
      storage,
      commands,
      changeNotification,
      order,
    )().then(() => {
      expect(commands.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateName: 'order',
          aggregateId: 'order-1',
          command: 'CONFIRM',
        }),
      );
    });
  });

  test('falls back to REQUIRE_CONFIRMATION for expensive orders with no reputation', () => {
    storage.find = makeFindMock({ storedReputation: null });
    order.value = 5000; // over 1000 threshold

    return reputationCheckSideEffect(
      storage,
      commands,
      changeNotification,
      order,
    )().then(() => {
      expect(commands.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateName: 'order',
          aggregateId: 'order-1',
          command: 'REQUIRE_CONFIRMATION',
        }),
      );
    });
  });

  test('fires background LLM reputation update', () => {
    storage.find = makeFindMock({ storedReputation: null });
    mockJsonCompletion.mockResolvedValue({
      content: { reputation: 'good', reasoning: 'Great customer' },
    });

    return reputationCheckSideEffect(
      storage,
      commands,
      changeNotification,
      order,
    )()
      .then(flushPromises)
      .then(() => {
        // Background LLM call was made
        expect(mockJsonCompletion).toHaveBeenCalledOnce();
        const [messages, opts] = mockJsonCompletion.mock.calls[0];
        expect(messages[0].role).toBe('user');
        expect(opts.systemPrompt).toContain('Alice');

        // Background UPDATE_CUSTOMER_REPUTATION command was sent
        expect(commands.execute).toHaveBeenCalledWith(
          expect.objectContaining({
            aggregateName: 'customer',
            aggregateId: 'cust-1',
            command: 'UPDATE_CUSTOMER_REPUTATION',
            payload: expect.objectContaining({
              reputation: 'good',
              reasoning: 'Great customer',
              failSafe: false,
              orderId: 'order-1',
              orderValue: 500,
              customerName: 'Alice',
              path: 'AUTO_CONFIRM',
            }),
          }),
        );
      });
  });

  test('background LLM error does not break order routing', () => {
    storage.find = makeFindMock({ storedReputation: null });
    mockJsonCompletion.mockRejectedValue(new Error('LLM down'));

    return reputationCheckSideEffect(
      storage,
      commands,
      changeNotification,
      order,
    )()
      .then(flushPromises)
      .then(() => {
        // Order was still routed (value-based)
        expect(commands.execute).toHaveBeenCalledWith(
          expect.objectContaining({
            aggregateName: 'order',
            command: 'CONFIRM',
          }),
        );
      });
  });

  test('background LLM fail-safe on unknown reputation value', () => {
    storage.find = makeFindMock({ storedReputation: null });
    mockJsonCompletion.mockResolvedValue({
      content: { reputation: 'excellent', reasoning: 'Custom value' },
    });

    return reputationCheckSideEffect(
      storage,
      commands,
      changeNotification,
      order,
    )()
      .then(flushPromises)
      .then(() => {
        expect(commands.execute).toHaveBeenCalledWith(
          expect.objectContaining({
            command: 'UPDATE_CUSTOMER_REPUTATION',
            payload: expect.objectContaining({
              reputation: 'neutral',
              failSafe: true,
              path: 'STANDARD',
            }),
          }),
        );
      });
  });

  test('payload includes all 7 required fields', () => {
    storage.find = makeFindMock({ storedReputation: null });
    mockJsonCompletion.mockResolvedValue({
      content: { reputation: 'good', reasoning: 'Solid' },
    });

    return reputationCheckSideEffect(
      storage,
      commands,
      changeNotification,
      order,
    )()
      .then(flushPromises)
      .then(() => {
        const reputationCall = commands.execute.mock.calls.find(
          (c) => c[0].command === 'UPDATE_CUSTOMER_REPUTATION',
        );
        expect(reputationCall).toBeDefined();
        const payload = reputationCall[0].payload;
        expect(payload).toHaveProperty('reputation');
        expect(payload).toHaveProperty('reasoning');
        expect(payload).toHaveProperty('failSafe');
        expect(payload).toHaveProperty('orderId');
        expect(payload).toHaveProperty('orderValue');
        expect(payload).toHaveProperty('customerName');
        expect(payload).toHaveProperty('path');
      });
  });
});

describe('reputationCheck read model projections', () => {
  describe('CUSTOMER_REPUTATION_UPDATED', () => {
    const projection =
      reputationCheckReadModel.projections.CUSTOMER_REPUTATION_UPDATED;

    test('stores reputation record and sends change notification', () => {
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
          reputation: 'good',
          reasoning: 'Reliable',
          failSafe: false,
          orderId: 'order-1',
          orderValue: 500,
          path: 'AUTO_CONFIRM',
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
        expect(insertedDocs[0].collection).toBe('orders_reputation');
        expect(insertedDocs[0].doc).toEqual({
          customerId: 'cust-1',
          customerName: 'Alice',
          reputation: 'good',
          reasoning: 'Reliable',
          failSafe: false,
          orderId: 'order-1',
          orderValue: 500,
          path: 'AUTO_CONFIRM',
          timestamp: '2026-01-01T00:00:00.000Z',
        });

        expect(sendChangeNotification).toHaveBeenCalledOnce();
        expect(createChangeInfo).toHaveBeenCalledWith(
          'orders',
          'reputation',
          'cust-1',
          'addRow',
          expect.objectContaining({
            customerId: 'cust-1',
            reputation: 'good',
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
          reputation: 'neutral',
          reasoning: 'New',
          failSafe: true,
          orderId: 'order-2',
          orderValue: 0,
          path: 'STANDARD',
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
