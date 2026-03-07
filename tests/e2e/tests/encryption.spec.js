import { test, expect } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { waitForApp, createCustomer } from './helpers/app.js';

test.describe('Encryption at rest', () => {
  test('customer PII fields are stored as Vault ciphertext in MongoDB', async ({
    browser,
    baseURL,
  }) => {
    const unique = `${Date.now()}`;
    const customerName = `EncTest-${unique}`;
    const customerLocation = `EncCity-${unique}`;

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await waitForApp(page, baseURL);

      // Create a customer through the UI
      await createCustomer(page, {
        name: customerName,
        location: customerLocation,
      });

      // Query MongoDB directly to inspect stored data
      const client = new MongoClient('mongodb://mongo:27017');
      try {
        await client.connect();
        const db = client.db('readmodel-customers');
        const collection = db.collection('customers_editing');

        // Find the most recent customer - since we can't search by encrypted
        // name, get all and find the one that was just created by checking
        // that its name field is NOT the plaintext we sent (i.e., it's encrypted)
        const docs = await collection.find({}).toArray();

        // There should be at least one document
        expect(docs.length).toBeGreaterThan(0);

        // Find our document: with encryption, the name field should contain
        // vault:v1: prefix rather than the plaintext customer name.
        // No document should have our plaintext name stored directly.
        const plaintextMatch = docs.find(
          (d) => d.name === customerName || d.location === customerLocation,
        );
        expect(
          plaintextMatch,
          'Customer PII should NOT be stored as plaintext in MongoDB',
        ).toBeUndefined();

        // At least one document should have encrypted fields (stored as
        // objects with __encrypted: true and a vault-wrapped DEK in wk)
        const encryptedDocs = docs.filter(
          (d) =>
            d.name &&
            typeof d.name === 'object' &&
            d.name.__encrypted === true &&
            typeof d.name.wk === 'string' &&
            d.name.wk.startsWith('vault:v1:') &&
            d.location &&
            typeof d.location === 'object' &&
            d.location.__encrypted === true &&
            typeof d.location.wk === 'string' &&
            d.location.wk.startsWith('vault:v1:'),
        );
        expect(
          encryptedDocs.length,
          'Expected at least one customer with vault-encrypted name and location',
        ).toBeGreaterThan(0);
      } finally {
        await client.close();
      }
    } finally {
      await context.close();
    }
  });
});
