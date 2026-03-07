import { defineEncryptionSchema } from '@lazyapps/encryption';

const customerFields = {
  'payload.name': { context: 'personal', subjectField: 'aggregateId' },
  'payload.location': { context: 'personal', subjectField: 'aggregateId' },
};

export const encryptionSchema = defineEncryptionSchema({
  CUSTOMER_CREATED: customerFields,
  CUSTOMER_UPDATED: customerFields,
  ORDER_CREATED: {
    'payload.text': {
      context: 'order-details',
      subjectField: 'payload.customerId',
    },
  },
});

export const encryptionContexts = {
  personal: { roles: ['admin', 'support', 'self', 'customer-service', 'order-service'] },
  'order-details': { roles: ['admin', 'support', 'sales', 'order-service'] },
};

export const readModelEncryptionConfig = {
  customers_editing: {
    name: { context: 'personal', subjectField: 'id' },
    location: { context: 'personal', subjectField: 'id' },
  },
  customers_overview: {
    name: { context: 'personal', subjectField: 'id' },
  },
  // Order collections are NOT encrypted at storage level because
  // projections read across collections (ORDER_CREATED reads customer
  // name from orders_customers, ORDER_CONFIRMATION_REQUIRED reads from
  // orders_overview). The wrapStorage layer only encrypts writes — reads
  // return raw encrypted objects, which breaks cross-collection lookups.
  // PII in orders is still encrypted at rest in the event store.
};
