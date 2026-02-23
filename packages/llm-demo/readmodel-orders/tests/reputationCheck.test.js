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

describe('reputationCheckSideEffect', () => {
  let storage;
  let commands;
  let changeNotification;
  let order;

  beforeEach(() => {
    vi.clearAllMocks();

    storage = {
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            { text: 'Widget', value: 100, status: 'confirmed' },
            { text: 'Gadget', value: 200, status: 'confirmed' },
          ]),
        }),
      }),
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

  test('calls LLM with order history and routes good reputation to CONFIRM', () => {
    mockJsonCompletion.mockResolvedValue({
      content: { reputation: 'good', reasoning: 'Great customer' },
    });

    const thunk = reputationCheckSideEffect(
      storage,
      commands,
      changeNotification,
      order,
    );
    expect(typeof thunk).toBe('function');

    return thunk().then(() => {
      // Verify LLM was called
      expect(mockJsonCompletion).toHaveBeenCalledOnce();
      const [messages, opts] = mockJsonCompletion.mock.calls[0];
      expect(messages[0].role).toBe('user');
      expect(opts.systemPrompt).toContain('Alice');
      expect(opts.systemPrompt).toContain('reputation');

      // Verify UPDATE_CUSTOMER_REPUTATION command (fire-and-forget)
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

      // Verify order routing: good → CONFIRM
      expect(commands.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateName: 'order',
          aggregateId: 'order-1',
          command: 'CONFIRM',
        }),
      );
    });
  });

  test('routes poor reputation to REQUIRE_CONFIRMATION', () => {
    mockJsonCompletion.mockResolvedValue({
      content: { reputation: 'poor', reasoning: 'Red flags' },
    });

    return reputationCheckSideEffect(
      storage,
      commands,
      changeNotification,
      order,
    )().then(() => {
      // Verify order routing: poor → REQUIRE_CONFIRMATION
      expect(commands.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateName: 'order',
          aggregateId: 'order-1',
          command: 'REQUIRE_CONFIRMATION',
        }),
      );

      // Verify payload has correct path
      expect(commands.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'UPDATE_CUSTOMER_REPUTATION',
          payload: expect.objectContaining({
            path: 'ENHANCED_REVIEW',
          }),
        }),
      );
    });
  });

  test('routes neutral reputation to value-based check (STANDARD path)', () => {
    mockJsonCompletion.mockResolvedValue({
      content: { reputation: 'neutral', reasoning: 'Mixed signals' },
    });

    // For STANDARD path with value <= 1000, should CONFIRM
    order.value = 500;

    return reputationCheckSideEffect(
      storage,
      commands,
      changeNotification,
      order,
    )().then(() => {
      // Verify payload has STANDARD path
      expect(commands.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'UPDATE_CUSTOMER_REPUTATION',
          payload: expect.objectContaining({
            path: 'STANDARD',
          }),
        }),
      );

      // STANDARD routes through checkOrderValueSideEffect
      // which calls either CONFIRM or REQUIRE_CONFIRMATION based on value
      expect(commands.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateName: 'order',
          aggregateId: 'order-1',
        }),
      );
    });
  });

  test('applies fail-safe on LLM parse error', () => {
    mockJsonCompletion.mockResolvedValue({
      error: 'Invalid JSON from LLM',
      content: null,
    });

    return reputationCheckSideEffect(
      storage,
      commands,
      changeNotification,
      order,
    )().then(() => {
      // Verify fail-safe: defaults to neutral
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

  test('applies fail-safe on unknown reputation value', () => {
    mockJsonCompletion.mockResolvedValue({
      content: { reputation: 'excellent', reasoning: 'Custom value' },
    });

    return reputationCheckSideEffect(
      storage,
      commands,
      changeNotification,
      order,
    )().then(() => {
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
    mockJsonCompletion.mockResolvedValue({
      content: { reputation: 'good', reasoning: 'Solid' },
    });

    return reputationCheckSideEffect(
      storage,
      commands,
      changeNotification,
      order,
    )().then(() => {
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

  test('fire-and-forget command error does not break order routing', () => {
    mockJsonCompletion.mockResolvedValue({
      content: { reputation: 'good', reasoning: 'Great' },
    });

    // Make the reputation command reject
    let callCount = 0;
    commands.execute.mockImplementation((cmd) => {
      callCount++;
      if (cmd.command === 'UPDATE_CUSTOMER_REPUTATION') {
        return () => Promise.reject(new Error('command store error'));
      }
      return () => Promise.resolve();
    });

    return reputationCheckSideEffect(
      storage,
      commands,
      changeNotification,
      order,
    )().then(() => {
      // Order routing should still succeed
      expect(commands.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateName: 'order',
          command: 'CONFIRM',
        }),
      );
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
