import { test, expect } from '@playwright/test';
import {
  waitForApp,
  navigate,
  createCustomer,
  placeOrder,
  confirmOrder,
} from './helpers/app.js';

test.describe('Baseline order workflows (F1, F2, F10)', () => {
  test('F1: small order auto-confirms', async ({ browser, baseURL }) => {
    const unique = `${Date.now()}`;
    const customerName = `TestCust-${unique}`;
    const orderText = `Widget-${unique}`;

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await waitForApp(page, baseURL);

      await createCustomer(page, {
        name: customerName,
        location: 'TestCity',
      });

      await placeOrder(page, customerName, {
        text: orderText,
        value: 13.99,
      });

      // Navigate to Orders and verify auto-confirmed
      await navigate(page, 'Orders');
      const row = page.locator('tr', {
        has: page.getByText(orderText, { exact: true }),
      });
      await expect(row.getByText('confirmed', { exact: true })).toBeVisible({
        timeout: 30000,
      });
    } finally {
      await context.close();
    }
  });

  test('F2: large order requires manual confirmation', async ({
    browser,
    baseURL,
  }) => {
    const unique = `${Date.now()}`;
    const customerName = `TestCust-${unique}`;
    const orderText = `Expensive-${unique}`;

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await waitForApp(page, baseURL);

      await createCustomer(page, {
        name: customerName,
        location: 'TestCity',
      });

      await placeOrder(page, customerName, {
        text: orderText,
        value: 1500,
      });

      // Verify unconfirmed on Orders page
      await navigate(page, 'Orders');
      const row = page.locator('tr', {
        has: page.getByText(orderText, { exact: true }),
      });
      await expect(
        row.getByText('unconfirmed', { exact: true })
      ).toBeVisible({ timeout: 30000 });

      // Confirm the order
      await confirmOrder(page, orderText);

      // Verify status changed to confirmed
      await navigate(page, 'Orders');
      const rowAfter = page.locator('tr', {
        has: page.getByText(orderText, { exact: true }),
      });
      await expect(
        rowAfter.getByText('confirmed', { exact: true })
      ).toBeVisible({ timeout: 30000 });
    } finally {
      await context.close();
    }
  });

  test('F10: real-time sync across browser contexts', async ({
    browser,
    baseURL,
  }) => {
    const unique = `${Date.now()}`;
    const customerName = `SyncCust-${unique}`;

    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      await waitForApp(page1, baseURL);
      await waitForApp(page2, baseURL);

      // page2 navigates to Customers BEFORE the customer exists
      await navigate(page2, 'Customers');
      await page2.getByText('New Customer').waitFor();

      // page1: Create a customer
      await createCustomer(page1, {
        name: customerName,
        location: 'SyncCity',
      });

      // page2: Customer arrives via change notification (already on Customers)
      // Scope to table cell to avoid matching LLM panel customer chips
      await expect(
        page2.locator('td', { hasText: customerName }).first()
      ).toBeVisible({ timeout: 15000 });
    } finally {
      await context1.close();
      await context2.close();
    }
  });
});
