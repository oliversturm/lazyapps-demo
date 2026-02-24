import {
  doesntExist,
  exists,
  has,
  is,
  isFiniteNumber,
  oneOf,
} from './validate.js';

export default {
  initial: () => ({}),

  commands: {
    CREATE: (aggregate, payload) => {
      doesntExist(aggregate);
      has(payload, 'customerId');
      has(payload, 'text');
      has(payload, 'value');
      isFiniteNumber(payload, 'value');
      return { type: 'ORDER_CREATED', payload };
    },

    REQUIRE_CONFIRMATION: (aggregate) => {
      exists(aggregate);
      is(aggregate, 'status', 'new');
      return { type: 'ORDER_CONFIRMATION_REQUIRED' };
    },

    CONFIRM: (aggregate) => {
      exists(aggregate);
      oneOf(aggregate, 'status', ['new', 'unconfirmed']);
      return { type: 'ORDER_CONFIRMED' };
    },

    DECLINE: (aggregate) => {
      exists(aggregate);
      is(aggregate, 'status', 'unconfirmed');
      return { type: 'ORDER_DECLINED' };
    },
  },

  projections: {
    ORDER_CREATED: (aggregate, { timestamp }) => ({
      ...aggregate,
      creationTimestamp: timestamp,
      status: 'new',
    }),

    ORDER_CONFIRMATION_REQUIRED: (aggregate) => ({
      ...aggregate,
      status: 'unconfirmed',
    }),

    ORDER_CONFIRMED: (aggregate) => ({
      ...aggregate,
      status: 'confirmed',
    }),

    ORDER_DECLINED: (aggregate) => ({
      ...aggregate,
      status: 'declined',
    }),
  },
};
