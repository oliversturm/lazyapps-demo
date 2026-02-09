import { expect } from '@playwright/test';

/**
 * Wait for the app to be ready by retrying page load until the nav bar appears.
 * Dev servers inside Docker may take time to compile on first request.
 */
export const waitForApp = async (page, url) => {
  const maxAttempts = 15;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 3000 });
      await page.locator('.bg-orange-100').waitFor({ timeout: 2000 });
      return;
    } catch {
      if (i === maxAttempts - 1)
        throw new Error(`App at ${url} not ready after ${maxAttempts} attempts`);
      await page.waitForTimeout(1000);
    }
  }
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
  // Wait for Vite dev compilation + SvelteKit hydration on first visit
  await page.waitForLoadState('networkidle');
  await page.locator('input[name="name"]').waitFor({ timeout: 10000 });
  await page.locator('input[name="name"]').fill(name);
  await page.locator('input[name="location"]').fill(location);
  await page.getByText('Save').click();
  // CQRS pipeline: command → event → read model → UI update
  await page.getByText(name).waitFor({ timeout: 10000 });
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
  // Wait for Vite dev compilation + SvelteKit hydration on first visit
  await page.waitForLoadState('networkidle');
  await page.locator('input[name="text"]').waitFor({ timeout: 10000 });
  await page.locator('input[name="text"]').fill(text);
  await page.locator('input[name="value"]').fill(String(value));
  await page.getByText('Save').click();
  // CQRS pipeline: command → event → read model → UI update
  await page.getByText(customerName).waitFor({ timeout: 10000 });
};

/**
 * Confirm an order from the order confirmation requests page.
 */
export const confirmOrder = async (page, orderText) => {
  await navigate(page, 'Order Confirmation Requests');
  // CQRS pipeline: wait for order data to appear
  await page.getByText(orderText).waitFor({ timeout: 10000 });
  const row = page.locator('tr', {
    has: page.getByText(orderText, { exact: true }),
  });
  await row.getByText('Confirm', { exact: true }).waitFor({ timeout: 10000 });
  await row.getByText('Confirm', { exact: true }).click();
};
