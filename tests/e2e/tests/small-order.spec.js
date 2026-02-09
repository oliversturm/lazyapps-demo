import { test, expect } from '@playwright/test';
import {
  waitForApp,
  navigate,
  createCustomer,
  placeOrder,
} from './helpers/app.js';

test.describe('Small order workflow', () => {
  test('auto-confirms and gets USD info', async ({ browser, baseURL }) => {
    const unique = `${Date.now()}`;
    const customerName = `TestCust-${unique}`;
    const orderText = `Widget-${unique}`;

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

      // page1: Create a customer
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

      // page1: Place a small order (value <= 1000, should auto-confirm)
      await placeOrder(page1, customerName, {
        text: orderText,
        value: 13.99,
      });

      // page2: Order arrives via change notification (already on Orders)
      await expect(page2.getByText(orderText)).toBeVisible({
        timeout: 10000,
      });

      // page1: Navigate to Orders, verify auto-confirmed
      await navigate(page1, 'Orders');
      const row1 = page1.locator('tr', {
        has: page1.getByText(orderText, { exact: true }),
      });
      await expect(row1.getByText('confirmed', { exact: true })).toBeVisible({
        timeout: 10000,
      });

      // page1: Wait for USD info to appear (exchange rate side effect)
      const lastCell1 = row1.locator('td').last();
      await expect(lastCell1).not.toHaveText('', { timeout: 5000 });
    } finally {
      await context1.close();
      await context2.close();
    }
  });
});
