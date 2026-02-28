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
        value: 13.99,
      });

      await expect(page2.getByText(orderText)).toBeVisible();

      await navigate(page1, 'Orders');
      const row1 = page1.locator('tr', {
        has: page1.getByText(orderText, { exact: true }),
      });
      await expect(row1.getByText('confirmed', { exact: true })).toBeVisible();

      const lastCell1 = row1.locator('td').last();
      await expect(lastCell1).not.toHaveText('');
    } finally {
      await context1.close();
      await context2.close();
    }
  });
});
