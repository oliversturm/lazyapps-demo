import { describe, test, expect } from 'vitest';
import customerAggregate from '../aggregates/customer.js';

describe('customer aggregate', () => {
  const existingAggregate = { creationTimestamp: 1000 };
  const emptyAggregate = {};

  describe('UPDATE_CUSTOMER_REPUTATION command', () => {
    const handler = customerAggregate.commands.UPDATE_CUSTOMER_REPUTATION;

    test('produces CUSTOMER_REPUTATION_UPDATED event with all payload fields', () => {
      const payload = {
        reputation: 'good',
        reasoning: 'Reliable customer',
        failSafe: false,
        orderId: 'order-1',
        orderValue: 250,
        customerName: 'Alice',
        path: 'AUTO_CONFIRM',
      };
      const result = handler(existingAggregate, payload);
      expect(result).toEqual({
        type: 'CUSTOMER_REPUTATION_UPDATED',
        payload,
      });
    });

    test('throws when aggregate does not exist', () => {
      const payload = {
        reputation: 'good',
        orderId: 'order-1',
        customerName: 'Alice',
        path: 'STANDARD',
      };
      expect(() => handler(emptyAggregate, payload)).toThrow(
        "The aggregate doesn't exist",
      );
    });

    test('throws when reputation is missing', () => {
      const payload = {
        orderId: 'order-1',
        customerName: 'Alice',
        path: 'STANDARD',
      };
      expect(() => handler(existingAggregate, payload)).toThrow(
        "required field 'reputation'",
      );
    });

    test('throws when orderId is missing', () => {
      const payload = {
        reputation: 'neutral',
        customerName: 'Alice',
        path: 'STANDARD',
      };
      expect(() => handler(existingAggregate, payload)).toThrow(
        "required field 'orderId'",
      );
    });

    test('throws when customerName is missing', () => {
      const payload = {
        reputation: 'neutral',
        orderId: 'order-1',
        path: 'STANDARD',
      };
      expect(() => handler(existingAggregate, payload)).toThrow(
        "required field 'customerName'",
      );
    });

    test('throws when path is missing', () => {
      const payload = {
        reputation: 'neutral',
        orderId: 'order-1',
        customerName: 'Alice',
      };
      expect(() => handler(existingAggregate, payload)).toThrow(
        "required field 'path'",
      );
    });
  });

  describe('RECORD_TREND_ANALYSIS command', () => {
    const handler = customerAggregate.commands.RECORD_TREND_ANALYSIS;

    test('produces CUSTOMER_TREND_ANALYZED event with all payload fields', () => {
      const payload = {
        analysisType: 'potential-issues',
        result: { riskLevel: 'low', issues: [], summary: 'All clear' },
        customerName: 'Bob',
        orderCount: 5,
        trigger: 'event-driven',
      };
      const result = handler(existingAggregate, payload);
      expect(result).toEqual({
        type: 'CUSTOMER_TREND_ANALYZED',
        payload,
      });
    });

    test('throws when aggregate does not exist', () => {
      const payload = {
        analysisType: 'potential-issues',
        result: {},
        customerName: 'Bob',
      };
      expect(() => handler(emptyAggregate, payload)).toThrow(
        "The aggregate doesn't exist",
      );
    });

    test('throws when analysisType is missing', () => {
      const payload = { result: {}, customerName: 'Bob' };
      expect(() => handler(existingAggregate, payload)).toThrow(
        "required field 'analysisType'",
      );
    });

    test('throws when result is missing', () => {
      const payload = {
        analysisType: 'potential-issues',
        customerName: 'Bob',
      };
      expect(() => handler(existingAggregate, payload)).toThrow(
        "required field 'result'",
      );
    });

    test('throws when customerName is missing', () => {
      const payload = { analysisType: 'potential-issues', result: {} };
      expect(() => handler(existingAggregate, payload)).toThrow(
        "required field 'customerName'",
      );
    });
  });

  describe('CUSTOMER_REPUTATION_UPDATED projection', () => {
    const projection =
      customerAggregate.projections.CUSTOMER_REPUTATION_UPDATED;

    test('stores latestReputation on aggregate', () => {
      const aggregate = { creationTimestamp: 1000, someField: 'keep' };
      const event = { payload: { reputation: 'good', path: 'AUTO_CONFIRM' } };
      const result = projection(aggregate, event);
      expect(result).toEqual({
        creationTimestamp: 1000,
        someField: 'keep',
        latestReputation: 'good',
      });
    });
  });

  describe('CUSTOMER_TREND_ANALYZED projection', () => {
    const projection = customerAggregate.projections.CUSTOMER_TREND_ANALYZED;

    test('returns aggregate unchanged', () => {
      const aggregate = {
        creationTimestamp: 1000,
        latestReputation: 'neutral',
      };
      const result = projection(aggregate);
      expect(result).toBe(aggregate);
    });
  });
});
