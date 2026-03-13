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
 * Retries on failure since the redirect chain (app → Keycloak → app)
 * can be slow under load.
 */
export const keycloakLogin = async (page, url, username, password) => {
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

      // Wait for Keycloak login form — may take time on first load
      await page.locator('#username').waitFor({ timeout: 15000 });
      await page.locator('#username').fill(username);
      await page.locator('#password').fill(password);
      await page.locator('#kc-login').click();

      // Wait for redirect back to app — nav bar appears when authenticated
      await page.locator('.bg-orange-100').waitFor({ timeout: 20000 });
      return;
    } catch {
      if (attempt === maxAttempts - 1) throw new Error(
        `keycloakLogin failed for ${username} at ${url} after ${maxAttempts} attempts`,
      );
      await page.waitForTimeout(2000);
    }
  }
};

/**
 * Wait for the app to be ready by retrying page load until authenticated
 * and the nav bar appears. Handles the Keycloak login redirect.
 * Dev servers inside Docker may take time to compile on first request.
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
        await navBar.waitFor({ timeout: 15000 });
      }

      return;
    } catch {
      if (i === maxAttempts - 1)
        throw new Error(`App at ${url} not ready after ${maxAttempts} attempts`);
      await page.waitForTimeout(2000);
    }
  }
};

/**
 * Navigate to a page by clicking the nav button with the given text.
 * Works for both Svelte (a tags) and React (button tags) frontends.
 * Retries on element detachment which can happen during re-renders.
 */
export const navigate = async (page, name) => {
  await page.locator('.bg-orange-100').waitFor();
  const navItem = page
    .locator('.bg-orange-100')
    .getByRole('link', { name })
    .or(page.locator('.bg-orange-100').getByRole('button', { name }));
  await navItem.waitFor({ state: 'visible', timeout: 5000 });
  await navItem.click({ timeout: 10000 });
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
  await page.locator('input[name="name"]').waitFor({ timeout: 15000 });
  await page.locator('input[name="name"]').fill(name);
  await page.locator('input[name="location"]').fill(location);
  await page.getByText('Save').click();
  // CQRS pipeline: command → event → read model → UI update
  await page.getByText(name).waitFor({ timeout: 30000 });
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
  await row.getByText('Place Order').waitFor({ state: 'visible', timeout: 5000 });
  await row.getByText('Place Order').click({ timeout: 10000 });
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
