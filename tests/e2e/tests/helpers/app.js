import { expect } from '@playwright/test';

/**
 * Wait for the app to be ready. Docker health checks guarantee services
 * are up before Playwright starts, so a single load is sufficient.
 */
export const waitForApp = async (page, url) => {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('.bg-orange-100').waitFor();
};

/**
 * Navigate to a page by clicking the nav button with the given text.
 * Works for both Svelte (a tags) and React (button tags) frontends.
 */
export const navigate = async (page, name) => {
  await page.locator('.bg-orange-100').waitFor();
  await page
    .locator('.bg-orange-100')
    .getByRole('link', { name })
    .or(page.locator('.bg-orange-100').getByRole('button', { name }))
    .click();
};

/**
 * Create a customer with the given name and location.
 */
export const createCustomer = async (page, { name, location }) => {
  await navigate(page, 'Customers');
  await page.getByText('New Customer').waitFor();
  await page.getByText('New Customer').click();
  await page.locator('input[name="name"]').waitFor();
  await page.locator('input[name="name"]').fill(name);
  await page.locator('input[name="location"]').fill(location);
  await page.getByText('Save').click();
  // After save, the app navigates to the customer list. The read model
  // may not be updated yet (async command processing), so poll with
  // page reloads until the customer name appears.
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    try {
      await page.getByText(name).waitFor({ timeout: 2000 });
      return;
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded' });
    }
  }
  await page.getByText(name).waitFor({ timeout: 2000 });
};

/**
 * Place an order for a customer.
 */
export const placeOrder = async (page, customerName, { text, value }) => {
  await navigate(page, 'Customers');
  await page.getByText(customerName).waitFor();
  const row = page.locator('tr', {
    has: page.getByText(customerName, { exact: true }),
  });
  await row.getByText('Place Order').click();
  await page.locator('input[name="text"]').waitFor();
  await page.locator('input[name="text"]').fill(text);
  await page.locator('input[name="value"]').fill(String(value));
  await page.getByText('Save').click();
  await page.getByText(customerName).waitFor();
};

/**
 * Confirm an order from the order confirmation requests page.
 */
export const confirmOrder = async (page, orderText) => {
  await navigate(page, 'Order Confirmation Requests');
  await page.getByText(orderText).waitFor();
  const row = page.locator('tr', {
    has: page.getByText(orderText, { exact: true }),
  });
  await row.getByText('Confirm', { exact: true }).waitFor();
  await row.getByText('Confirm', { exact: true }).click();
};
