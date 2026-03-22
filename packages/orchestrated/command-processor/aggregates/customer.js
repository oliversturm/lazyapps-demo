import {
  doesntExist,
  exists,
  has,
  notForgotten,
  requireOwnerOrAdmin,
} from './validate.js';

export default {
  initial: (aggregateId) => ({ id: aggregateId }),

  commands: {
    CREATE: (aggregate, payload, auth) => {
      requireOwnerOrAdmin(auth, aggregate.id);
      doesntExist(aggregate);
      has(payload, 'name');
      return { type: 'CUSTOMER_CREATED', payload };
    },

    UPDATE: (aggregate, payload, auth) => {
      requireOwnerOrAdmin(auth, aggregate.id);
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
  },
};
