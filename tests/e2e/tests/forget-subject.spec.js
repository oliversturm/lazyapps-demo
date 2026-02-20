import { test, expect } from '@playwright/test';
import {
  waitForApp,
  navigate,
  createCustomer,
  placeOrder,
} from './helpers/app.js';

test.describe('Forget subject workflow', () => {
  test.beforeEach(({ }, testInfo) => {
    test.skip(
      testInfo.project.name === 'monolith-svelte',
      'Forget subject requires encryption (Vault), not available in monolith',
    );
  });

  test('forgets customer and removes their orders', async ({
    browser,
    baseURL,
  }) => {
    const unique = `${Date.now()}`;
    const customerName = `ForgetMe-${unique}`;
    const orderText = `Order-${unique}`;

    const context1 = await browser.newContext();
    const page1 = await context1.newPage();

    try {
      await waitForApp(page1, baseURL);

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
      await row.getByText('Forget').click();

      // Customer should disappear from overview
      await expect(page1.getByText(customerName)).toBeHidden({
        timeout: 10000,
      });

      // Orders for that customer should also be gone
      await navigate(page1, 'Orders');
      await expect(page1.getByText(orderText)).toBeHidden({ timeout: 10000 });
    } finally {
      await context1.close();
    }
  });
});
