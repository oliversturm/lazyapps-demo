import { describe, test, expect } from 'vitest';
import history from '../readmodels/history.js';

describe('event history whitelist', () => {
  const projectionTypes = Object.keys(history.projections);

  test('includes CUSTOMER_REPUTATION_UPDATED', () => {
    expect(projectionTypes).toContain('CUSTOMER_REPUTATION_UPDATED');
  });

  test('includes CUSTOMER_TREND_ANALYZED', () => {
    expect(projectionTypes).toContain('CUSTOMER_TREND_ANALYZED');
  });

  test('includes all original event types', () => {
    expect(projectionTypes).toContain('CUSTOMER_CREATED');
    expect(projectionTypes).toContain('CUSTOMER_UPDATED');
    expect(projectionTypes).toContain('ORDER_CREATED');
    expect(projectionTypes).toContain('ORDER_CONFIRMED');
    expect(projectionTypes).toContain('ORDER_CONFIRMATION_REQUIRED');
  });

  test('all projections are functions', () => {
    for (const type of projectionTypes) {
      expect(typeof history.projections[type]).toBe('function');
    }
  });

  test('generic projection inserts event into storage', () => {
    const insertedDocs = [];
    const context = {
      storage: {
        insertOne: (collection, doc) => {
          insertedDocs.push({ collection, doc });
          return Promise.resolve();
        },
      },
    };
    const event = {
      aggregateId: 'cust-1',
      aggregateName: 'customer',
      type: 'CUSTOMER_REPUTATION_UPDATED',
      payload: { reputation: 'good' },
      timestamp: 1000,
    };

    return history.projections.CUSTOMER_REPUTATION_UPDATED(context, event).then(
      () => {
        expect(insertedDocs).toHaveLength(1);
        expect(insertedDocs[0].collection).toBe('eventHistory');
        expect(insertedDocs[0].doc).toEqual({
          aggregateId: 'cust-1',
          aggregateName: 'customer',
          type: 'CUSTOMER_REPUTATION_UPDATED',
          payload: { reputation: 'good' },
          timestamp: 1000,
        });
      },
    );
  });
});
