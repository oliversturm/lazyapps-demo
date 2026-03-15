import { defineEncryptionSchema } from '@lazyapps/encryption';

const customerFields = {
  'payload.name': { context: 'personal', subjectField: 'aggregateId' },
  'payload.location': { context: 'personal', subjectField: 'aggregateId' },
};

export const encryptionSchema = defineEncryptionSchema({
  events: {
    CUSTOMER_CREATED: customerFields,
    CUSTOMER_UPDATED: customerFields,
  },
});

export const encryptionContexts = {
  personal: {
    roles: ['admin', 'support', 'self', 'customer-service', 'order-service'],
    autoForget: true,
    // Field names protected by this context — used by the change-notifier's
    // auto-redaction engine to replace these fields with [restricted] for
    // users whose scopes don't include any of the context's roles.
    fields: { name: {}, location: {}, customerName: {} },
  },
  'order-details': { roles: ['admin', 'support', 'sales', 'order-service'] },
};

export const encryptionSubjects = {
  customer: { contexts: ['personal'] },
};

export const readModelEncryptionConfig = {
  customers_editing: {
    name: { context: 'personal', subjectField: 'id' },
    location: { context: 'personal', subjectField: 'id' },
  },
  customers_overview: {
    name: { context: 'personal', subjectField: 'id' },
  },
  orders_customers: {
    name: { context: 'personal', subjectField: 'id' },
  },
  orders_overview: {
    customerName: { context: 'personal', subjectField: 'customerId' },
  },
  orders_confirmation_requests: {
    customerName: { context: 'personal', subjectField: 'customerId' },
  },
};
