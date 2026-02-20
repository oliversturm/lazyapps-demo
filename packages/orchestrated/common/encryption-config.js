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
  personal: { roles: ['admin', 'support', 'self'] },
  'order-details': { roles: ['admin', 'support', 'sales'] },
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
