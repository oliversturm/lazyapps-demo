import { test, expect } from '@playwright/test';
import {
  waitForApp,
  navigate,
  createCustomer,
  placeOrder,
} from './helpers/app.js';

test.describe('Forget subject workflow', () => {
  test('forgets customer and anonymizes their data', async ({
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
        page1.locator('tr', { has: page1.getByText(orderText) }).getByText('[deleted]'),
      ).toBeVisible({ timeout: 10000 });
    } finally {
      await context1.close();
    }
  });
});
