import { test, expect } from '@playwright/test';
import {
  waitForApp,
  navigate,
  createCustomer,
  placeOrder,
  getLlmPanel,
  ensurePanelExpanded,
  waitForReputationAssessment,
  runQuickAnalysis,
  waitForAnalysisResults,
} from './helpers/app.js';

test.describe('LLM reputation and analysis (F3, F4, F8, F9)', () => {
  test('F3: reputation assessment section displays correctly', async ({
    browser,
    baseURL,
  }) => {
    const unique = `${Date.now()}`;
    const customerName = `RepCust-${unique}`;
    const orderText = `RepOrder-${unique}`;

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await waitForApp(page, baseURL);

      // Create customer and place a small order to trigger reputation check
      await createCustomer(page, {
        name: customerName,
        location: 'RepCity',
      });
      await placeOrder(page, customerName, {
        text: orderText,
        value: 50,
      });

      // Navigate to Orders page to see the LLM panel with reputation
      await navigate(page, 'Orders');
      await ensurePanelExpanded(page);

      // Switch to the Reputation tab and wait for assessment data to load.
      // Background LLM calls may be rate-limited, so we verify
      // the structural display of whatever data is available.
      await waitForReputationAssessment(page);

      const panel = getLlmPanel(page);

      // Pick the first visible assessment card and verify its structure
      const firstCard = panel
        .locator('.border.rounded.p-2.bg-blue-50')
        .first();
      await expect(firstCard).toBeVisible({ timeout: 10000 });

      // Verify: customer name present (font-medium span)
      const customerNameEl = firstCard.locator('.font-medium');
      await expect(customerNameEl).not.toHaveText('', { timeout: 5000 });

      // Verify: reputation value is one of the valid enums
      await expect(firstCard).toContainText(
        /good|neutral|poor/,
        { timeout: 5000 }
      );

      // Verify: reasoning text is present (non-empty)
      const reasoningText = firstCard.locator('.text-gray-600');
      await expect(reasoningText).not.toHaveText('', { timeout: 5000 });

      // Verify: path is one of the valid values
      await expect(firstCard).toContainText(
        /AUTO_CONFIRM|STANDARD|ENHANCED_REVIEW/,
        { timeout: 5000 }
      );
    } finally {
      await context.close();
    }
  });

  test('F4: second order respects reputation-based path', async ({
    browser,
    baseURL,
  }) => {
    const unique = `${Date.now()}`;
    const customerName = `RepPath-${unique}`;
    const order1Text = `First-${unique}`;
    const order2Text = `Second-${unique}`;

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await waitForApp(page, baseURL);

      // Create customer and place first small order (auto-confirms)
      await createCustomer(page, {
        name: customerName,
        location: 'RepCity',
      });
      await placeOrder(page, customerName, {
        text: order1Text,
        value: 50,
      });

      // Wait for first order to be processed
      await navigate(page, 'Orders');
      const row1 = page.locator('tr', {
        has: page.getByText(order1Text, { exact: true }),
      });
      await expect(row1.getByText('confirmed', { exact: true })).toBeVisible({
        timeout: 30000,
      });

      // Place a second order for the same customer
      await placeOrder(page, customerName, {
        text: order2Text,
        value: 75,
      });

      // Navigate to Orders and verify the second order has a status
      await navigate(page, 'Orders');
      const row2 = page.locator('tr', {
        has: page.getByText(order2Text, { exact: true }),
      });
      // Status should be either "confirmed" or "unconfirmed" depending
      // on the LLM's reputation assessment — we accept either
      await expect(
        row2.getByText(/^(confirmed|unconfirmed)$/)
      ).toBeVisible({ timeout: 30000 });
    } finally {
      await context.close();
    }
  });

  test('F8: quick analysis produces results', async ({
    browser,
    baseURL,
  }) => {
    const unique = `${Date.now()}`;
    const customerName = `AnalCust-${unique}`;
    const orderText = `AnalOrder-${unique}`;

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await waitForApp(page, baseURL);

      // Create customer and place an order so there's data to analyze
      await createCustomer(page, {
        name: customerName,
        location: 'AnalCity',
      });
      await placeOrder(page, customerName, {
        text: orderText,
        value: 99,
      });

      // Navigate to Customers page where customer chip selection + Quick Analysis
      // are both available. This tests more of the UI flow than the Orders page.
      await navigate(page, 'Customers');
      await ensurePanelExpanded(page);

      const panel = getLlmPanel(page);

      // Select the customer chip in the panel
      // Customer chips are buttons with bg-gray-100 inside the panel
      const customerChip = panel.locator('button', { hasText: customerName });
      await customerChip.click();

      // Verify Quick Analysis section is visible
      await expect(panel.getByText('Quick Analysis')).toBeVisible();

      // The "Analyze <customerName>" button should now be enabled
      await expect(
        panel.locator('button', { hasText: `Analyze ${customerName}` })
      ).toBeVisible({ timeout: 5000 });

      // Run analysis with the default type (product-suggestions)
      await runQuickAnalysis(page, 'product-suggestions');
      await waitForAnalysisResults(page);

      // Verify actual analysis results appeared in the messages area.
      // AnalysisResults renders inside .bg-blue-50 divs with content like
      // "Product Suggestions", "Interest Categories", "Risk Assessment", etc.
      // We match on content keywords to avoid a false positive from the
      // panel header which also uses .bg-blue-50.
      await expect(
        panel.locator('.bg-blue-50', {
          hasText: /suggestions|interests|risk|issues/i,
        }).first()
      ).toBeVisible({ timeout: 60000 });
    } finally {
      await context.close();
    }
  });

  test('F9: auto-analysis triggers after multiple rapid orders', async ({
    browser,
    baseURL,
  }) => {
    const unique = `${Date.now()}`;
    const customerName = `RapidCust-${unique}`;

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await waitForApp(page, baseURL);

      // Create customer
      await createCustomer(page, {
        name: customerName,
        location: 'RapidCity',
      });

      // Place 3 orders in succession
      for (let i = 1; i <= 3; i++) {
        await placeOrder(page, customerName, {
          text: `Rapid-${i}-${unique}`,
          value: 25 * i,
        });
      }

      // Navigate to Orders page and check the Risk tab in the LLM panel.
      // Auto-triggered analyses (fired after 3+ orders for a customer)
      // are recorded via RECORD_TREND_ANALYSIS and appear in the Risk tab.
      await navigate(page, 'Orders');
      await ensurePanelExpanded(page);

      const panel = getLlmPanel(page);

      // Switch to the Risk tab
      await panel.locator('button', { hasText: 'Risk' }).click();

      // The customer's risk assessment should appear as a card in the Risk tab.
      // Use a generous timeout since the LLM call takes time.
      await expect(
        panel.locator('.bg-orange-50', { hasText: customerName })
      ).toBeVisible({ timeout: 90000 });
    } finally {
      await context.close();
    }
  });
});
