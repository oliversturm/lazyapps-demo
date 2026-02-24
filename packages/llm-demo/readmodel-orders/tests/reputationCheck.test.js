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
    storedReasoning = null,
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
        const record = storedReputation
          ? [{ reputation: storedReputation, reasoning: storedReasoning }]
          : [];
        return {
          sort: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue(record),
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

  test('skips UPDATE_CUSTOMER_REPUTATION when reputation and reasoning unchanged', () => {
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
      storedReasoning: 'Still good',
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

// --- Tests exposing the stale-reasoning bug ---
//
// The change detection in updateReputationInBackground (reputationCheck.js
// lines ~107-113) compares ONLY the reputation value (good/neutral/poor).
// When the LLM returns the same reputation value but different reasoning
// text, the UPDATE_CUSTOMER_REPUTATION command is suppressed — leaving
// stale reasoning in the read model.
//
// These tests assert the CORRECT behavior (update should be sent when
// reasoning changes). They are expected to FAIL on the current code,
// proving the bug exists.

describe('reputationReassessmentSideEffect — stale reasoning bug', () => {
  let commands;

  // Extended mock that also tracks stored reasoning alongside reputation,
  // so the fix can compare both fields.
  const makeStorageMock = ({
    orderData = null,
    orderHistory = [],
    storedReputation = null,
    storedReasoning = null,
  } = {}) => ({
    find: vi.fn().mockImplementation((collection, query) => {
      if (collection === 'orders_overview' && query.id) {
        return {
          toArray: vi.fn().mockResolvedValue(orderData ? [orderData] : []),
        };
      }
      if (collection === 'orders_overview' && query.customerId) {
        return {
          project: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue(orderHistory),
          }),
        };
      }
      if (collection === 'orders_reputation') {
        return {
          sort: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              project: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue(
                  storedReputation
                    ? [
                        {
                          reputation: storedReputation,
                          reasoning: storedReasoning,
                        },
                      ]
                    : [],
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

  test('sends update when reasoning changes but reputation value stays the same', () => {
    const orderData = {
      id: 'order-2',
      customerId: 'cust-1',
      customerName: 'Alice',
      value: 300,
    };
    const storage = makeStorageMock({
      orderData,
      orderHistory: [
        { text: 'Widget', value: 100, status: 'confirmed' },
        { text: 'Gadget', value: 200, status: 'confirmed' },
        { text: 'Doohickey', value: 300, status: 'confirmed' },
      ],
      storedReputation: 'neutral',
      storedReasoning: 'Only one confirmed order — insufficient data',
    });
    mockJsonCompletion.mockResolvedValue({
      content: {
        reputation: 'neutral',
        reasoning:
          'Three confirmed orders with consistent values — building positive history but still neutral',
      },
    });

    return reputationReassessmentSideEffect(
      storage,
      commands,
      'order-2',
    )()
      .then(flushPromises)
      .then(() => {
        // BUG: Current code only compares reputation value, not reasoning.
        // The update should be sent because reasoning changed, but current
        // code skips it since reputation is still 'neutral'.
        expect(commands.execute).toHaveBeenCalledWith(
          expect.objectContaining({
            aggregateName: 'customer',
            aggregateId: 'cust-1',
            command: 'UPDATE_CUSTOMER_REPUTATION',
            payload: expect.objectContaining({
              reputation: 'neutral',
              reasoning:
                'Three confirmed orders with consistent values — building positive history but still neutral',
            }),
          }),
        );
      });
  });

  test('multi-order progression updates reasoning even when reputation stays neutral', () => {
    // Customer already has reputation 'neutral' with old reasoning from
    // an earlier assessment. A new order is confirmed and the LLM produces
    // updated reasoning reflecting the larger order history, but the
    // reputation value remains 'neutral'.
    const orderData = {
      id: 'order-3',
      customerId: 'cust-1',
      customerName: 'Alice',
      value: 450,
    };
    const storage = makeStorageMock({
      orderData,
      orderHistory: [
        { text: 'Widget', value: 100, status: 'confirmed' },
        { text: 'Gadget', value: 200, status: 'confirmed' },
        { text: 'Doohickey', value: 300, status: 'confirmed' },
        { text: 'Thingamajig', value: 450, status: 'confirmed' },
      ],
      storedReputation: 'neutral',
      storedReasoning: 'Three confirmed orders — building history',
    });
    mockJsonCompletion.mockResolvedValue({
      content: {
        reputation: 'neutral',
        reasoning:
          'Four confirmed orders with growing values — approaching good standing',
      },
    });

    return reputationReassessmentSideEffect(
      storage,
      commands,
      'order-3',
    )()
      .then(flushPromises)
      .then(() => {
        // Should send update since reasoning is different, even though
        // reputation value remains 'neutral'.
        expect(commands.execute).toHaveBeenCalledWith(
          expect.objectContaining({
            command: 'UPDATE_CUSTOMER_REPUTATION',
            payload: expect.objectContaining({
              reputation: 'neutral',
              reasoning:
                'Four confirmed orders with growing values — approaching good standing',
            }),
          }),
        );
      });
  });

  test('does not send update when both reputation and reasoning are identical', () => {
    // Control case: when BOTH reputation and reasoning are the same,
    // the update should genuinely be skipped. This verifies that the fix
    // does not over-trigger updates.
    const orderData = {
      id: 'order-4',
      customerId: 'cust-1',
      customerName: 'Alice',
      value: 500,
    };
    const storage = makeStorageMock({
      orderData,
      orderHistory: [
        { text: 'Widget', value: 100, status: 'confirmed' },
        { text: 'Gadget', value: 500, status: 'confirmed' },
      ],
      storedReputation: 'neutral',
      storedReasoning: 'Two confirmed orders — steady pattern',
    });
    mockJsonCompletion.mockResolvedValue({
      content: {
        reputation: 'neutral',
        reasoning: 'Two confirmed orders — steady pattern',
      },
    });

    return reputationReassessmentSideEffect(
      storage,
      commands,
      'order-4',
    )()
      .then(flushPromises)
      .then(() => {
        // When both reputation and reasoning are identical, no update needed.
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
