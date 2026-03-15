import { expect } from '@playwright/test';

// Default Keycloak test user (admin with full access)
export const DEFAULT_USER = {
  username: 'alice',
  password: 'alice',
};

/**
 * Log into the app via Keycloak login page.
 * The app uses onLoad: 'login-required', so navigating to it redirects
 * to Keycloak. We fill in the login form and submit.
 */
export const keycloakLogin = async (page, url, username, password) => {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5000 });
  await page.locator('#username').waitFor({ timeout: 5000 });
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
  // Wait for redirect back to app — nav bar appears when authenticated
  await page.locator('.bg-orange-100').waitFor({ timeout: 5000 });
};

/**
 * Wait for the app to be ready by retrying page load until authenticated
 * and the nav bar appears. Handles the Keycloak login redirect.
 */
export const waitForApp = async (
  page,
  url,
  { username, password } = DEFAULT_USER,
) => {
  const maxAttempts = 15;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5000 });

      // Check if we landed on the Keycloak login page
      const usernameField = page.locator('#username');
      const navBar = page.locator('.bg-orange-100');

      // Race: either Keycloak form or app nav bar appears first
      const first = await Promise.race([
        usernameField
          .waitFor({ timeout: 5000 })
          .then(() => 'keycloak'),
        navBar
          .waitFor({ timeout: 5000 })
          .then(() => 'app'),
      ]);

      if (first === 'keycloak') {
        await usernameField.fill(username);
        await page.locator('#password').fill(password);
        await page.locator('#kc-login').click();
        await navBar.waitFor({ timeout: 5000 });
      }

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
  const navItem = page
    .locator('.bg-orange-100')
    .getByRole('link', { name })
    .or(page.locator('.bg-orange-100').getByRole('button', { name }));
  await navItem.waitFor({ state: 'visible' });
  await navItem.click();
};

/**
 * Create a customer with the given name and location.
 */
export const createCustomer = async (page, { name, location }) => {
  await navigate(page, 'Customers');
  await page.getByText('New Customer').waitFor();
  await page.getByText('New Customer').click();
  await page.waitForLoadState('networkidle');
  await page.locator('input[name="name"]').waitFor();
  await page.locator('input[name="name"]').fill(name);
  await page.locator('input[name="location"]').fill(location);
  await page.getByText('Save').click();
  // CQRS pipeline: command → event → read model → UI update.
  // Use .first() because the React frontend renders the name in multiple
  // table cells (overview + detail columns).
  await page.getByText(name).first().waitFor({ timeout: 1000 });
};

/**
 * Place an order for a customer.
 */
export const placeOrder = async (page, customerName, { text, value }) => {
  await navigate(page, 'Customers');
  await page.getByText(customerName).first().waitFor();
  const row = page.locator('tr', {
    has: page.getByText(customerName, { exact: true }),
  }).first();
  await row.getByText('Place Order').waitFor({ state: 'visible' });
  await row.getByText('Place Order').click();
  await page.waitForLoadState('networkidle');
  await page.locator('input[name="text"]').waitFor();
  await page.locator('input[name="text"]').fill(text);
  await page.locator('input[name="value"]').fill(String(value));
  await page.getByText('Save').click();
  // CQRS pipeline: command → event → read model → UI update
  await page.getByText(customerName).first().waitFor({ timeout: 1000 });
};

/**
 * Confirm an order from the order confirmation requests page.
 */
export const confirmOrder = async (page, orderText) => {
  await navigate(page, 'Order Confirmation Requests');
  // CQRS pipeline: wait for order data to appear
  await page.getByText(orderText).waitFor({ timeout: 1000 });
  const row = page.locator('tr', {
    has: page.getByText(orderText, { exact: true }),
  });
  await row.getByText('Confirm', { exact: true }).waitFor();
  await row.getByText('Confirm', { exact: true }).click();
};
