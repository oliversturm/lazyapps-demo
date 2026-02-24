import { describe, test, expect } from 'vitest';
import orderAggregate from '../aggregates/order.js';

describe('order aggregate', () => {
  const emptyAggregate = {};
  const existingAggregate = { creationTimestamp: 1000, status: 'new' };

  describe('CREATE command', () => {
    const handler = orderAggregate.commands.CREATE;

    test('returns ORDER_CREATED event with numeric value', () => {
      const payload = {
        customerId: 'cust-1',
        text: 'Widget',
        value: 13.99,
      };
      const result = handler(emptyAggregate, payload);
      expect(result).toEqual({
        type: 'ORDER_CREATED',
        payload,
      });
      expect(typeof result.payload.value).toBe('number');
    });

    test('accepts zero value', () => {
      const payload = { customerId: 'cust-1', text: 'Free sample', value: 0 };
      const result = handler(emptyAggregate, payload);
      expect(result.payload.value).toBe(0);
    });

    test('accepts negative value', () => {
      const payload = { customerId: 'cust-1', text: 'Refund', value: -25 };
      const result = handler(emptyAggregate, payload);
      expect(result.payload.value).toBe(-25);
    });

    test('accepts decimal value', () => {
      const payload = {
        customerId: 'cust-1',
        text: 'Precise item',
        value: 0.01,
      };
      const result = handler(emptyAggregate, payload);
      expect(result.payload.value).toBe(0.01);
    });

    test('rejects string value', () => {
      const payload = {
        customerId: 'cust-1',
        text: 'Widget',
        value: '13.99',
      };
      expect(() => handler(emptyAggregate, payload)).toThrow();
    });

    test('rejects NaN value', () => {
      const payload = { customerId: 'cust-1', text: 'Widget', value: NaN };
      expect(() => handler(emptyAggregate, payload)).toThrow();
    });

    test('rejects Infinity value', () => {
      const payload = {
        customerId: 'cust-1',
        text: 'Widget',
        value: Infinity,
      };
      expect(() => handler(emptyAggregate, payload)).toThrow();
    });

    test('rejects -Infinity value', () => {
      const payload = {
        customerId: 'cust-1',
        text: 'Widget',
        value: -Infinity,
      };
      expect(() => handler(emptyAggregate, payload)).toThrow();
    });

    test('rejects null value', () => {
      const payload = { customerId: 'cust-1', text: 'Widget', value: null };
      expect(() => handler(emptyAggregate, payload)).toThrow();
    });

    test('rejects undefined value', () => {
      const payload = { customerId: 'cust-1', text: 'Widget' };
      expect(() => handler(emptyAggregate, payload)).toThrow();
    });

    test('rejects missing customerId', () => {
      const payload = { text: 'Widget', value: 10 };
      expect(() => handler(emptyAggregate, payload)).toThrow(
        "required field 'customerId'",
      );
    });

    test('rejects missing text', () => {
      const payload = { customerId: 'cust-1', value: 10 };
      expect(() => handler(emptyAggregate, payload)).toThrow(
        "required field 'text'",
      );
    });

    test('throws when aggregate already exists', () => {
      const payload = {
        customerId: 'cust-1',
        text: 'Widget',
        value: 10,
      };
      expect(() => handler(existingAggregate, payload)).toThrow(
        'The aggregate exists already',
      );
    });
  });

  describe('REQUIRE_CONFIRMATION command', () => {
    const handler = orderAggregate.commands.REQUIRE_CONFIRMATION;

    test('returns ORDER_CONFIRMATION_REQUIRED event', () => {
      const result = handler(existingAggregate);
      expect(result).toEqual({ type: 'ORDER_CONFIRMATION_REQUIRED' });
    });

    test('throws when aggregate does not exist', () => {
      expect(() => handler(emptyAggregate)).toThrow(
        "The aggregate doesn't exist",
      );
    });

    test('throws when status is not new', () => {
      expect(() =>
        handler({ creationTimestamp: 1000, status: 'confirmed' }),
      ).toThrow("unexpected value 'confirmed'");
    });
  });

  describe('CONFIRM command', () => {
    const handler = orderAggregate.commands.CONFIRM;

    test('returns ORDER_CONFIRMED event for new order', () => {
      const result = handler(existingAggregate);
      expect(result).toEqual({ type: 'ORDER_CONFIRMED' });
    });

    test('returns ORDER_CONFIRMED event for unconfirmed order', () => {
      const result = handler({
        creationTimestamp: 1000,
        status: 'unconfirmed',
      });
      expect(result).toEqual({ type: 'ORDER_CONFIRMED' });
    });

    test('throws when aggregate does not exist', () => {
      expect(() => handler(emptyAggregate)).toThrow(
        "The aggregate doesn't exist",
      );
    });

    test('throws when status is not new or unconfirmed', () => {
      expect(() =>
        handler({ creationTimestamp: 1000, status: 'declined' }),
      ).toThrow("unexpected value 'declined'");
    });
  });

  describe('DECLINE command', () => {
    const handler = orderAggregate.commands.DECLINE;

    test('returns ORDER_DECLINED event', () => {
      const result = handler({
        creationTimestamp: 1000,
        status: 'unconfirmed',
      });
      expect(result).toEqual({ type: 'ORDER_DECLINED' });
    });

    test('throws when aggregate does not exist', () => {
      expect(() => handler(emptyAggregate)).toThrow(
        "The aggregate doesn't exist",
      );
    });

    test('throws when status is not unconfirmed', () => {
      expect(() =>
        handler({ creationTimestamp: 1000, status: 'new' }),
      ).toThrow("unexpected value 'new'");
    });
  });

  describe('ORDER_CREATED projection', () => {
    const projection = orderAggregate.projections.ORDER_CREATED;

    test('sets creationTimestamp and status to new', () => {
      const result = projection(emptyAggregate, { timestamp: 42 });
      expect(result).toEqual({
        creationTimestamp: 42,
        status: 'new',
      });
    });
  });

  describe('ORDER_CONFIRMATION_REQUIRED projection', () => {
    const projection = orderAggregate.projections.ORDER_CONFIRMATION_REQUIRED;

    test('sets status to unconfirmed', () => {
      const result = projection(existingAggregate);
      expect(result).toEqual({
        creationTimestamp: 1000,
        status: 'unconfirmed',
      });
    });
  });

  describe('ORDER_CONFIRMED projection', () => {
    const projection = orderAggregate.projections.ORDER_CONFIRMED;

    test('sets status to confirmed', () => {
      const result = projection(existingAggregate);
      expect(result).toEqual({
        creationTimestamp: 1000,
        status: 'confirmed',
      });
    });
  });

  describe('ORDER_DECLINED projection', () => {
    const projection = orderAggregate.projections.ORDER_DECLINED;

    test('sets status to declined', () => {
      const result = projection({
        creationTimestamp: 1000,
        status: 'unconfirmed',
      });
      expect(result).toEqual({
        creationTimestamp: 1000,
        status: 'declined',
      });
    });
  });
});
