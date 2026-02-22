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

export const dekBackend = {
  url: process.env.DEK_MONGO_URL || process.env.MONGO_URL || 'mongodb://127.0.0.1:27017',
  database: process.env.DEK_MONGO_DATABASE || 'encryption-keys',
  collection: process.env.DEK_MONGO_COLLECTION || 'deks',
};

export const encryptionContexts = {
  personal: { roles: ['admin', 'support', 'self', 'customer-service', 'order-service'] },
  'order-details': { roles: ['admin', 'support', 'sales', 'order-service'] },
};

export const readModelEncryptionConfig = {
  customers: {
    name: { context: 'personal', subjectField: 'customerId' },
    location: { context: 'personal', subjectField: 'customerId' },
  },
  orderSummaries: {
    customerName: { context: 'personal', subjectField: 'customerId' },
    orderText: { context: 'order-details', subjectField: 'customerId' },
  },
};
