import { test, expect } from '@playwright/test';
import {
  waitForApp,
  navigate,
  createCustomer,
  placeOrder,
  confirmOrder,
} from './helpers/app.js';

test.describe('Large order workflow', () => {
  test('requires manual confirmation', async ({ browser, baseURL }) => {
    const unique = `${Date.now()}`;
    const customerName = `TestCust-${unique}`;
    const orderText = `Expensive-${unique}`;

    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      await waitForApp(page1, baseURL);
      await waitForApp(page2, baseURL);

      // page2 navigates to Customers BEFORE the customer exists
      await navigate(page2, 'Customers');
      // Ensure route is compiled before page1 starts interacting
      await page2.getByText('New Customer').waitFor();

      // page1: Create customer
      await createCustomer(page1, {
        name: customerName,
        location: 'TestCity',
      });

      // page2: Customer arrives via change notification (already on Customers)
      await expect(page2.getByText(customerName)).toBeVisible({
        timeout: 10000,
      });

      // page2: Navigate to Orders BEFORE the order exists
      await navigate(page2, 'Orders');

      // page1: Place large order (value > 1000, needs manual confirmation)
      await placeOrder(page1, customerName, {
        text: orderText,
        value: 1500,
      });

      // page2: Unconfirmed order arrives via change notification (already on Orders)
      const row2 = page2.locator('tr', {
        has: page2.getByText(orderText, { exact: true }),
      });
      await expect(row2.getByText('unconfirmed', { exact: true })).toBeVisible({
        timeout: 10000,
      });

      // page1: Navigate to Orders, verify unconfirmed
      await navigate(page1, 'Orders');
      const row1 = page1.locator('tr', {
        has: page1.getByText(orderText, { exact: true }),
      });
      await expect(row1.getByText('unconfirmed', { exact: true })).toBeVisible({
        timeout: 10000,
      });

			// page1: Confirm the order (this navigates to Order Confirmation Requests)
      await confirmOrder(page1, orderText);

      // page1: Verify status changed to confirmed
      await navigate(page1, 'Orders');
      const row1After = page1.locator('tr', {
        has: page1.getByText(orderText, { exact: true }),
      });
      await expect(
        row1After.getByText('confirmed', { exact: true }),
      ).toBeVisible({
        timeout: 10000,
      });

      // page2: Status changes to confirmed via change notification (still on Orders)
      await expect(row2.getByText('confirmed', { exact: true })).toBeVisible({
        timeout: 10000,
      });
    } finally {
      await context1.close();
      await context2.close();
    }
  });
});
