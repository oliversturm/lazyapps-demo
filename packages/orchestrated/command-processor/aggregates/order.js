import { doesntExist, exists, has, is, oneOf } from './validate.js';

const isCustomerForgotten = (aggregate, customerId) =>
  aggregate.relatedSubjectsForgotten &&
  aggregate.relatedSubjectsForgotten[customerId];

export default {
  initial: () => ({}),

  commands: {
    CREATE: (aggregate, payload) => {
      doesntExist(aggregate);
      has(payload, 'customerId');
      if (isCustomerForgotten(aggregate, payload.customerId)) {
        throw new Error(
          `Cannot create order: customer '${payload.customerId}' has been forgotten`,
        );
      }
      has(payload, 'text');
      has(payload, 'value');
      return { type: 'ORDER_CREATED', payload };
    },

    ADD_USD_RATE_AND_VALUE: (aggregate, payload) => {
      exists(aggregate);
      has(payload, 'time');
      has(payload, 'usdRate');
      has(payload, 'usdValue');
      return { type: 'ORDER_USD_RATE_AND_VALUE_ADDED', payload };
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

    FORGET_RELATED_SUBJECT: (aggregate, payload) => {
      if (!payload.relatedSubjectId) {
        throw new Error('Missing relatedSubjectId in payload');
      }
      if (!payload.relatedSubjectType) {
        throw new Error('Missing relatedSubjectType in payload');
      }
      if (!payload.contexts || !payload.contexts.length) {
        throw new Error('Missing contexts in payload');
      }
      return { type: 'RELATED_SUBJECT_FORGOTTEN', payload };
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

    RELATED_SUBJECT_FORGOTTEN: (aggregate, event) => ({
      ...aggregate,
      relatedSubjectsForgotten: {
        ...aggregate.relatedSubjectsForgotten,
        [event.payload.relatedSubjectId]: {
          type: event.payload.relatedSubjectType,
          contexts: event.payload.contexts,
          forgottenAt: event.timestamp,
        },
      },
    }),
  },
};
