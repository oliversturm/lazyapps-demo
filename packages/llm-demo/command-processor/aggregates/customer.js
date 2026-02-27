import { doesntExist, exists, has } from './validate.js';

export default {
  initial: () => ({}),

  commands: {
    CREATE: (aggregate, payload) => {
      doesntExist(aggregate);
      has(payload, 'name');
      return { type: 'CUSTOMER_CREATED', payload };
    },

    UPDATE: (aggregate, payload) => {
      exists(aggregate);
      has(payload, 'name');
      return { type: 'CUSTOMER_UPDATED', payload };
    },

    UPDATE_CUSTOMER_REPUTATION: (aggregate, payload) => {
      exists(aggregate);
      has(payload, 'reputation');
      has(payload, 'orderId');
      has(payload, 'customerName');
      has(payload, 'path');
      return { type: 'CUSTOMER_REPUTATION_UPDATED', payload };
    },

    RECORD_TREND_ANALYSIS: (aggregate, payload) => {
      exists(aggregate);
      has(payload, 'analysisType');
      has(payload, 'result');
      has(payload, 'customerName');
      return { type: 'CUSTOMER_TREND_ANALYZED', payload };
    },
  },

  projections: {
    CUSTOMER_CREATED: (aggregate, { timestamp }) => ({
      ...aggregate,
      creationTimestamp: timestamp,
    }),

    CUSTOMER_REPUTATION_UPDATED: (aggregate, { payload }) => ({
      ...aggregate,
      latestReputation: payload.reputation,
    }),

    CUSTOMER_TREND_ANALYZED: (aggregate) => aggregate,
  },
};
