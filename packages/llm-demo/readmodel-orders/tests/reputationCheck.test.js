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
  reputationRoutingSideEffect,
  reputationReassessmentSideEffect,
  default: reputationCheckReadModel,
} = await import('../readmodels/reputationCheck.js');

// Helper: let fire-and-forget microtasks settle
const flushPromises = () => new Promise((r) => setTimeout(r, 0));

describe('reputationRoutingSideEffect', () => {
  let storage;
  let commands;
  let order;

  const makeFindMock = ({ storedReputation = null } = {}) =>
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
      return {
        project: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      };
    });

  beforeEach(() => {
    vi.clearAllMocks();

    storage = {
      find: makeFindMock(),
    };

    commands = {
      execute: vi.fn().mockReturnValue(() => Promise.resolve()),
    };

    order = {
      id: 'order-1',
      customerId: 'cust-1',
      customerName: 'Alice',
      value: 500,
    };
  });

  test('good reputation + value <= $5000 → CONFIRM', () => {
    storage.find = makeFindMock({ storedReputation: 'good' });
    order.value = 4999;

    return reputationRoutingSideEffect(storage, commands, order)().then(() => {
      expect(commands.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateName: 'order',
          aggregateId: 'order-1',
          command: 'CONFIRM',
        }),
      );
    });
  });

  test('good reputation + value > $5000 → REQUIRE_CONFIRMATION', () => {
    storage.find = makeFindMock({ storedReputation: 'good' });
    order.value = 5001;

    return reputationRoutingSideEffect(storage, commands, order)().then(() => {
      expect(commands.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateName: 'order',
          aggregateId: 'order-1',
          command: 'REQUIRE_CONFIRMATION',
        }),
      );
    });
  });

  test('good reputation + value exactly $5000 → CONFIRM', () => {
    storage.find = makeFindMock({ storedReputation: 'good' });
    order.value = 5000;

    return reputationRoutingSideEffect(storage, commands, order)().then(() => {
      expect(commands.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'CONFIRM',
        }),
      );
    });
  });

  test('poor reputation + any value → REQUIRE_CONFIRMATION (threshold $0)', () => {
    storage.find = makeFindMock({ storedReputation: 'poor' });
    order.value = 1;

    return reputationRoutingSideEffect(storage, commands, order)().then(() => {
      expect(commands.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateName: 'order',
          aggregateId: 'order-1',
          command: 'REQUIRE_CONFIRMATION',
        }),
      );
    });
  });

  test('neutral reputation + value <= $1000 → CONFIRM', () => {
    storage.find = makeFindMock({ storedReputation: 'neutral' });
    order.value = 500;

    return reputationRoutingSideEffect(storage, commands, order)().then(() => {
      expect(commands.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'CONFIRM',
        }),
      );
    });
  });

  test('neutral reputation + value > $1000 → REQUIRE_CONFIRMATION', () => {
    storage.find = makeFindMock({ storedReputation: 'neutral' });
    order.value = 1500;

    return reputationRoutingSideEffect(storage, commands, order)().then(() => {
      expect(commands.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'REQUIRE_CONFIRMATION',
        }),
      );
    });
  });

  test('no stored reputation (unknown) uses $1000 threshold → CONFIRM', () => {
    storage.find = makeFindMock({ storedReputation: null });
    order.value = 500;

    return reputationRoutingSideEffect(storage, commands, order)().then(() => {
      expect(commands.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'CONFIRM',
        }),
      );
    });
  });

  test('no stored reputation (unknown) + expensive order → REQUIRE_CONFIRMATION', () => {
    storage.find = makeFindMock({ storedReputation: null });
    order.value = 5000;

    return reputationRoutingSideEffect(storage, commands, order)().then(() => {
      expect(commands.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'REQUIRE_CONFIRMATION',
        }),
      );
    });
  });
});

describe('reputationReassessmentSideEffect', () => {
  let storage;
  let commands;

  const makeStorageMock = ({
    orderData = null,
    orderHistory = [],
    storedReputation = null,
  } = {}) => ({
    find: vi.fn().mockImplementation((collection, query) => {
      if (collection === 'orders_overview' && query.id) {
        // Fetching the order by aggregateId
        return {
          toArray: vi.fn().mockResolvedValue(orderData ? [orderData] : []),
        };
      }
      if (collection === 'orders_overview' && query.customerId) {
        // Fetching order history for LLM
        return {
          project: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue(orderHistory),
          }),
        };
      }
      if (collection === 'orders_reputation') {
        // Change detection lookup
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
      return { toArray: vi.fn().mockResolvedValue([]) };
    }),
  });

  beforeEach(() => {
    vi.clearAllMocks();

    commands = {
      execute: vi.fn().mockReturnValue(() => Promise.resolve()),
    };
  });

  test('fetches order from storage and calls LLM', () => {
    const orderData = {
      id: 'order-1',
      customerId: 'cust-1',
      customerName: 'Alice',
      value: 500,
    };
    storage = makeStorageMock({
      orderData,
      orderHistory: [{ text: 'Widget', value: 100, status: 'confirmed' }],
      storedReputation: null,
    });
    mockJsonCompletion.mockResolvedValue({
      content: { reputation: 'good', reasoning: 'Great customer' },
    });

    return reputationReassessmentSideEffect(
      storage,
      commands,
      'order-1',
    )()
      .then(flushPromises)
      .then(() => {
        expect(mockJsonCompletion).toHaveBeenCalledOnce();
        const [messages, opts] = mockJsonCompletion.mock.calls[0];
        expect(messages[0].role).toBe('user');
        expect(opts.systemPrompt).toContain('Alice');
      });
  });

  test('sends UPDATE_CUSTOMER_REPUTATION when reputation changed', () => {
    const orderData = {
      id: 'order-1',
      customerId: 'cust-1',
      customerName: 'Alice',
      value: 500,
    };
    storage = makeStorageMock({
      orderData,
      orderHistory: [{ text: 'Widget', value: 100, status: 'confirmed' }],
      storedReputation: 'neutral',
    });
    mockJsonCompletion.mockResolvedValue({
      content: { reputation: 'good', reasoning: 'Improved' },
    });

    return reputationReassessmentSideEffect(
      storage,
      commands,
      'order-1',
    )()
      .then(flushPromises)
      .then(() => {
        expect(commands.execute).toHaveBeenCalledWith(
          expect.objectContaining({
            aggregateName: 'customer',
            aggregateId: 'cust-1',
            command: 'UPDATE_CUSTOMER_REPUTATION',
            payload: expect.objectContaining({
              reputation: 'good',
              reasoning: 'Improved',
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

  test('skips UPDATE_CUSTOMER_REPUTATION when reputation unchanged', () => {
    const orderData = {
      id: 'order-1',
      customerId: 'cust-1',
      customerName: 'Alice',
      value: 500,
    };
    storage = makeStorageMock({
      orderData,
      orderHistory: [{ text: 'Widget', value: 100, status: 'confirmed' }],
      storedReputation: 'good',
    });
    mockJsonCompletion.mockResolvedValue({
      content: { reputation: 'good', reasoning: 'Still good' },
    });

    return reputationReassessmentSideEffect(
      storage,
      commands,
      'order-1',
    )()
      .then(flushPromises)
      .then(() => {
        expect(commands.execute).not.toHaveBeenCalled();
      });
  });

  test('LLM error does not propagate', () => {
    const orderData = {
      id: 'order-1',
      customerId: 'cust-1',
      customerName: 'Alice',
      value: 500,
    };
    storage = makeStorageMock({
      orderData,
      orderHistory: [{ text: 'Widget', value: 100, status: 'confirmed' }],
    });
    mockJsonCompletion.mockRejectedValue(new Error('LLM down'));

    return reputationReassessmentSideEffect(
      storage,
      commands,
      'order-1',
    )()
      .then(flushPromises)
      .then(() => {
        // No commands executed, no error thrown
        expect(commands.execute).not.toHaveBeenCalled();
      });
  });

  test('LLM fail-safe on unknown reputation value', () => {
    const orderData = {
      id: 'order-1',
      customerId: 'cust-1',
      customerName: 'Alice',
      value: 500,
    };
    storage = makeStorageMock({
      orderData,
      orderHistory: [{ text: 'Widget', value: 100, status: 'confirmed' }],
      storedReputation: null,
    });
    mockJsonCompletion.mockResolvedValue({
      content: { reputation: 'excellent', reasoning: 'Custom value' },
    });

    return reputationReassessmentSideEffect(
      storage,
      commands,
      'order-1',
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
    const orderData = {
      id: 'order-1',
      customerId: 'cust-1',
      customerName: 'Alice',
      value: 500,
    };
    storage = makeStorageMock({
      orderData,
      orderHistory: [{ text: 'Widget', value: 100, status: 'confirmed' }],
      storedReputation: null,
    });
    mockJsonCompletion.mockResolvedValue({
      content: { reputation: 'good', reasoning: 'Solid' },
    });

    return reputationReassessmentSideEffect(
      storage,
      commands,
      'order-1',
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

  test('does nothing when order not found in storage', () => {
    storage = makeStorageMock({ orderData: null });

    return reputationReassessmentSideEffect(
      storage,
      commands,
      'nonexistent-order',
    )()
      .then(flushPromises)
      .then(() => {
        expect(mockJsonCompletion).not.toHaveBeenCalled();
        expect(commands.execute).not.toHaveBeenCalled();
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
          'all',
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
