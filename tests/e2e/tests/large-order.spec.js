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

      await navigate(page2, 'Customers');
      await page2.getByText('New Customer').waitFor();

      await createCustomer(page1, {
        name: customerName,
        location: 'TestCity',
      });

      await expect(page2.getByText(customerName)).toBeVisible();

      await navigate(page2, 'Orders');

      await placeOrder(page1, customerName, {
        text: orderText,
        value: 1500,
      });

      const row2 = page2.locator('tr', {
        has: page2.getByText(orderText, { exact: true }),
      });
      await expect(row2.getByText('unconfirmed', { exact: true })).toBeVisible();

      await navigate(page1, 'Orders');
      const row1 = page1.locator('tr', {
        has: page1.getByText(orderText, { exact: true }),
      });
      await expect(row1.getByText('unconfirmed', { exact: true })).toBeVisible();

      await confirmOrder(page1, orderText);

      await navigate(page1, 'Orders');
      const row1After = page1.locator('tr', {
        has: page1.getByText(orderText, { exact: true }),
      });
      await expect(
        row1After.getByText('confirmed', { exact: true }),
      ).toBeVisible();

      await expect(row2.getByText('confirmed', { exact: true })).toBeVisible();
    } finally {
      await context1.close();
      await context2.close();
    }
  });
});
