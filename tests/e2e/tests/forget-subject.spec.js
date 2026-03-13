import { test, expect } from '@playwright/test';
import {
  keycloakLogin,
  navigate,
  createCustomer,
  placeOrder,
} from './helpers/app.js';

// Each forget test uses a different Keycloak user to avoid aggregate
// conflicts — once a customer is forgotten, the aggregateId (= Keycloak sub)
// cannot be reused for CREATE, and the edit form redirects away.
// Svelte and React forget projects use separate user sets so both can run
// in the same test suite without conflicting.
const FORGET_USERS_BY_FRONTEND = {
  svelte: [
    { username: 'bob', password: 'bob' },
    { username: 'carol', password: 'carol' },
    { username: 'dave', password: 'dave' },
  ],
  react: [
    { username: 'eve', password: 'eve' },
    { username: 'frank', password: 'frank' },
    { username: 'grace', password: 'grace' },
  ],
};

const getForgetUser = (testInfo, index) => {
  const frontend = testInfo.project.name.includes('react')
    ? 'react'
    : 'svelte';
  return FORGET_USERS_BY_FRONTEND[frontend][index];
};

test.describe('Forget subject workflow', () => {
  test('forgets customer and anonymizes their data', async ({
    browser,
    baseURL,
  }, testInfo) => {
    const user = getForgetUser(testInfo, 0);
    const unique = `${Date.now()}`;
    const customerName = `ForgetMe-${unique}`;
    const orderText = `Order-${unique}`;

    const context1 = await browser.newContext();
    const page1 = await context1.newPage();

    try {
      await keycloakLogin(page1, baseURL, user.username, user.password);

      // Create a customer
      await createCustomer(page1, {
        name: customerName,
        location: 'TestCity',
      });

      // Place an order for the customer
      await placeOrder(page1, customerName, {
        text: orderText,
        value: 42,
      });

      // Verify order is visible in Orders view
      await navigate(page1, 'Orders');
      await expect(page1.getByText(orderText)).toBeVisible({ timeout: 10000 });

      // Navigate to Customers, find the customer row
      await navigate(page1, 'Customers');
      await page1.getByText(customerName).waitFor({ timeout: 10000 });

      const row = page1.locator('tr', {
        has: page1.getByText(customerName, { exact: true }),
      });

      // Set up dialog handler before clicking Forget
      page1.on('dialog', (dialog) => dialog.accept());

      // Click Forget
      await row.getByText('Forget', { exact: true }).click();

      // Customer name should be replaced with placeholder after key shredding
      await expect(page1.getByText(customerName)).toBeHidden({
        timeout: 10000,
      });

      // Customer row should still exist with placeholder values
      const forgottenRow = page1
        .locator('tr', { has: page1.getByText('[deleted]') })
        .first();
      await expect(forgottenRow).toBeVisible({ timeout: 10000 });

      // Edit button should be disabled for forgotten customer
      const editButton = forgottenRow.getByText('Edit', { exact: true });
      await expect(editButton).toBeVisible();
      await expect(editButton).toHaveClass(/pointer-events-none/);

      // Forget button should not be shown for already-forgotten customer
      await expect(
        forgottenRow.getByText('Forget', { exact: true }),
      ).toBeHidden();

      // Orders should still be visible with order text intact
      await navigate(page1, 'Orders');
      await expect(page1.getByText(orderText)).toBeVisible({ timeout: 10000 });

      // Customer name in orders should show placeholder
      await expect(
        page1
          .locator('tr', { has: page1.getByText(orderText) })
          .getByText('[deleted]'),
      ).toBeVisible({ timeout: 10000 });
    } finally {
      await context1.close();
    }
  });

  // T14: Cross-aggregate forget → order aggregate tracks it → UI blocks new orders
  test('forget customer disables Place Order button and preserves existing orders', async ({
    browser,
    baseURL,
  }, testInfo) => {
    const user = getForgetUser(testInfo, 1);
    const unique = `${Date.now()}`;
    const customerName = `CrossAgg-${unique}`;
    const orderText = `ExistingOrder-${unique}`;

    const context1 = await browser.newContext();
    const page1 = await context1.newPage();

    try {
      await keycloakLogin(page1, baseURL, user.username, user.password);

      // Create customer and place an order
      await createCustomer(page1, {
        name: customerName,
        location: 'CrossCity',
      });
      await placeOrder(page1, customerName, {
        text: orderText,
        value: 99,
      });

      // Verify order exists
      await navigate(page1, 'Orders');
      await expect(page1.getByText(orderText)).toBeVisible({ timeout: 10000 });

      // Forget the customer
      await navigate(page1, 'Customers');
      await page1.getByText(customerName).waitFor({ timeout: 10000 });

      page1.on('dialog', (dialog) => dialog.accept());

      const customerRow = page1.locator('tr', {
        has: page1.getByText(customerName, { exact: true }),
      });
      await customerRow.getByText('Forget', { exact: true }).click();

      // Wait for the customer to show as forgotten
      await expect(page1.getByText(customerName)).toBeHidden({
        timeout: 10000,
      });

      const forgottenRow = page1
        .locator('tr', { has: page1.getByText('[deleted]') })
        .first();
      await expect(forgottenRow).toBeVisible({ timeout: 10000 });

      // Place Order button should be disabled for forgotten customer
      const placeOrderButton = forgottenRow.getByText('Place Order', {
        exact: true,
      });
      await expect(placeOrderButton).toBeVisible();
      await expect(placeOrderButton).toHaveClass(/pointer-events-none/);

      // Existing order should still be intact (text and value preserved)
      await navigate(page1, 'Orders');
      const orderRow = page1.locator('tr', {
        has: page1.getByText(orderText, { exact: true }),
      });
      await expect(orderRow).toBeVisible({ timeout: 10000 });

      // Order text should still be readable (not encrypted under personal context)
      await expect(orderRow.getByText(orderText)).toBeVisible();

      // Customer name within the order row should show [deleted]
      await expect(orderRow.getByText('[deleted]')).toBeVisible({
        timeout: 10000,
      });
    } finally {
      await context1.close();
    }
  });

  // T15: Multi-context: forget personal → personal fields inaccessible,
  // non-personal order data remains intact
  test('forgetting personal context anonymizes PII but preserves order details', async ({
    browser,
    baseURL,
  }, testInfo) => {
    const user = getForgetUser(testInfo, 2);
    const unique = `${Date.now()}`;
    const customerName = `MultiCtx-${unique}`;
    const customerLocation = `CtxCity-${unique}`;
    const orderText1 = `OrderA-${unique}`;
    const orderText2 = `OrderB-${unique}`;

    const context1 = await browser.newContext();
    const page1 = await context1.newPage();

    try {
      await keycloakLogin(page1, baseURL, user.username, user.password);

      // Create customer with identifiable PII
      await createCustomer(page1, {
        name: customerName,
        location: customerLocation,
      });

      // Place two orders with different values
      await placeOrder(page1, customerName, {
        text: orderText1,
        value: 150,
      });
      await placeOrder(page1, customerName, {
        text: orderText2,
        value: 300,
      });

      // Verify both orders appear in Orders view
      await navigate(page1, 'Orders');
      await expect(page1.getByText(orderText1)).toBeVisible({ timeout: 10000 });
      await expect(page1.getByText(orderText2)).toBeVisible({ timeout: 10000 });

      // Forget the customer (shreds personal context keys)
      await navigate(page1, 'Customers');
      await page1.getByText(customerName).first().waitFor({ timeout: 10000 });

      page1.on('dialog', (dialog) => dialog.accept());

      const row = page1.locator('tr', {
        has: page1.getByText(customerName, { exact: true }),
      }).first();
      await row.getByText('Forget', { exact: true }).click();

      // Wait for forget to take effect
      await expect(page1.getByText(customerName).first()).toBeHidden({
        timeout: 10000,
      });

      // Personal fields should show [deleted] placeholder
      const forgottenRow = page1
        .locator('tr', { has: page1.getByText('[deleted]') })
        .first();
      await expect(forgottenRow).toBeVisible({ timeout: 10000 });

      // Customer name should be anonymized
      await expect(page1.getByText(customerName).first()).toBeHidden();

      // Navigate to Orders — order-specific data should be fully intact
      await navigate(page1, 'Orders');

      // Both orders should still appear with their original text
      const orderRow1 = page1.locator('tr', {
        has: page1.getByText(orderText1, { exact: true }),
      });
      const orderRow2 = page1.locator('tr', {
        has: page1.getByText(orderText2, { exact: true }),
      });

      await expect(orderRow1).toBeVisible({ timeout: 10000 });
      await expect(orderRow2).toBeVisible({ timeout: 10000 });

      // Order text fields (not under personal context) should be readable
      await expect(orderRow1.getByText(orderText1)).toBeVisible();
      await expect(orderRow2.getByText(orderText2)).toBeVisible();

      // Customer name column within order rows should show [deleted]
      await expect(orderRow1.getByText('[deleted]')).toBeVisible({
        timeout: 10000,
      });
      await expect(orderRow2.getByText('[deleted]')).toBeVisible({
        timeout: 10000,
      });

      // Order values (numeric, not PII) should still be visible
      await expect(orderRow1.getByText('150')).toBeVisible();
      await expect(orderRow2.getByText('300')).toBeVisible();
    } finally {
      await context1.close();
    }
  });
});
