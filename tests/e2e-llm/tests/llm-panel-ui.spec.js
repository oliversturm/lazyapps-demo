import { test, expect } from '@playwright/test';
import {
  waitForApp,
  navigate,
  getLlmPanel,
  getCollapsedPanel,
  getContextLabel,
  ensurePanelExpanded,
} from './helpers/app.js';

test.describe('LLM panel UI and navigation (F11)', () => {
  test('panel visibility per page', async ({ browser, baseURL }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await waitForApp(page, baseURL);

      // Customers page: panel should be visible
      await navigate(page, 'Customers');
      await expect(
        getLlmPanel(page).or(getCollapsedPanel(page))
      ).toBeVisible({ timeout: 10000 });

      // Orders page: panel should be visible
      await navigate(page, 'Orders');
      await expect(
        getLlmPanel(page).or(getCollapsedPanel(page))
      ).toBeVisible({ timeout: 10000 });

      // Order Confirmation Requests: panel should be visible
      await navigate(page, 'Order Confirmation Requests');
      await expect(
        getLlmPanel(page).or(getCollapsedPanel(page))
      ).toBeVisible({ timeout: 10000 });

      // Customer Service: panel should NOT be visible
      await navigate(page, 'Customer Service');
      await expect(getLlmPanel(page)).not.toBeVisible({ timeout: 5000 });
      await expect(getCollapsedPanel(page)).not.toBeVisible({ timeout: 5000 });

      // About: panel should NOT be visible
      await navigate(page, 'About');
      await expect(getLlmPanel(page)).not.toBeVisible({ timeout: 5000 });
      await expect(getCollapsedPanel(page)).not.toBeVisible({ timeout: 5000 });
    } finally {
      await context.close();
    }
  });

  test('context label shows correct page context', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await waitForApp(page, baseURL);

      // Navigate to Customers and verify context label
      await navigate(page, 'Customers');
      await ensurePanelExpanded(page);
      await expect(getContextLabel(page)).toHaveText('Customers');

      // Navigate to Orders and verify context label
      await navigate(page, 'Orders');
      await ensurePanelExpanded(page);
      await expect(getContextLabel(page)).toHaveText('Orders');

      // Navigate to Order Confirmation Requests and verify context label
      await navigate(page, 'Order Confirmation Requests');
      await ensurePanelExpanded(page);
      await expect(getContextLabel(page)).toHaveText('Confirmations');
    } finally {
      await context.close();
    }
  });

  test('collapse and expand functionality', async ({ browser, baseURL }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await waitForApp(page, baseURL);

      await navigate(page, 'Customers');
      await ensurePanelExpanded(page);

      // Verify panel is expanded (350px wide with LLM Assistant header)
      const panel = getLlmPanel(page);
      await expect(panel).toBeVisible();
      await expect(panel.getByText('LLM Assistant')).toBeVisible();

      // Click collapse button (the "—" button in the header)
      await panel.locator('button[title="Collapse panel"]').click();

      // Verify panel collapsed (50px wide bar with robot emoji)
      await expect(getCollapsedPanel(page)).toBeVisible({ timeout: 5000 });
      await expect(panel).not.toBeVisible();

      // Click to expand
      await getCollapsedPanel(page).click();

      // Verify panel is expanded again
      await expect(panel).toBeVisible({ timeout: 5000 });
      await expect(panel.getByText('LLM Assistant')).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
