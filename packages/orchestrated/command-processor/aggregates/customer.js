import { doesntExist, exists, has, notForgotten } from './validate.js';

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
      notForgotten(aggregate, 'name');
      has(payload, 'name');
      return { type: 'CUSTOMER_UPDATED', payload };
    },
  },

  projections: {
    CUSTOMER_CREATED: (aggregate, { payload, timestamp }) => ({
      ...aggregate,
      name: payload.name,
      creationTimestamp: timestamp,
    }),

    CUSTOMER_UPDATED: (aggregate, { payload }) => ({
      ...aggregate,
      name: payload.name,
    }),

    SUBJECT_FORGOTTEN: (aggregate, event) => ({
      ...aggregate,
      forgotten: true,
      forgottenAt: event.timestamp,
    }),
  },
};
