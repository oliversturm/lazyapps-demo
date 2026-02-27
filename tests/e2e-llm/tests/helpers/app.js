import { expect } from '@playwright/test';

// ─── Base helpers (adapted from existing e2e tests) ───

/**
 * Wait for the app to be ready by retrying page load until the nav bar appears.
 * Dev servers inside Docker may take time to compile on first request.
 */
export const waitForApp = async (page, url) => {
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5000 });
      await page.locator('.bg-orange-100').waitFor({ timeout: 3000 });
      const res = await page.request.post(
        'http://readmodel-customers/query/overview/all',
        { headers: { 'Content-Type': 'application/json' }, data: {} },
      );
      if (!res.ok()) throw new Error(`Backend returned ${res.status()}`);
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
 */
export const navigate = async (page, name) => {
  await page.locator('.bg-orange-100').waitFor();
  await page
    .locator('.bg-orange-100')
    .getByRole('link', { name })
    .click();
};

/**
 * Create a customer with the given name and location.
 */
export const createCustomer = async (page, { name, location }) => {
  await navigate(page, 'Customers');
  await page.getByText('New Customer').waitFor();
  await page.getByText('New Customer').click();
  await page.locator('input[name="name"]').waitFor({ timeout: 10000 });
  await page.locator('input[name="name"]').fill(name);
  await page.locator('input[name="location"]').fill(location);
  await page.getByText('Save').click();
  // CQRS pipeline: command → event → read model → UI update
  // Scope to table cell to avoid matching LLM panel customer chips
  await page.locator('td', { hasText: name }).first().waitFor({ timeout: 10000 });
};

/**
 * Place an order for a customer.
 */
export const placeOrder = async (page, customerName, { text, value }) => {
  await navigate(page, 'Customers');
  // Scope to table cell to avoid matching LLM panel customer chips
  await page.locator('td', { hasText: customerName }).first().waitFor({ timeout: 10000 });
  const row = page.locator('tr', {
    has: page.locator('td', { hasText: customerName }),
  });
  await row.getByText('Place Order').click();
  await page.locator('input[name="text"]').waitFor({ timeout: 10000 });
  await page.locator('input[name="text"]').fill(text);
  await page.locator('input[name="value"]').fill(String(value));
  await page.getByText('Save').click();
  // CQRS pipeline: command → event → read model → UI update
  await page.locator('td', { hasText: customerName }).first().waitFor({ timeout: 10000 });
};

/**
 * Confirm an order from the order confirmation requests page.
 */
export const confirmOrder = async (page, orderText) => {
  await navigate(page, 'Order Confirmation Requests');
  await page.getByText(orderText).waitFor({ timeout: 10000 });
  const row = page.locator('tr', {
    has: page.getByText(orderText, { exact: true }),
  });
  await row.getByText('Confirm', { exact: true }).waitFor({ timeout: 10000 });
  await row.getByText('Confirm', { exact: true }).click();
};

/**
 * Decline an order from the order confirmation requests page.
 */
export const declineOrder = async (page, orderText) => {
  await navigate(page, 'Order Confirmation Requests');
  await page.getByText(orderText).waitFor({ timeout: 10000 });
  const row = page.locator('tr', {
    has: page.getByText(orderText, { exact: true }),
  });
  await row.getByText('Decline', { exact: true }).waitFor({ timeout: 10000 });
  await row.getByText('Decline', { exact: true }).click();
};

/**
 * Get the customer ID by querying the customers readmodel API.
 */
export const getCustomerIdByName = async (page, customerName) => {
  const res = await page.request.post(
    'http://readmodel-customers/query/overview/all',
    { headers: { 'Content-Type': 'application/json' }, data: {} },
  );
  const customers = await res.json();
  const customer = customers.find((c) => c.name === customerName);
  return customer?.id;
};

/**
 * Poll the reputation API until at least `minCount` records exist for a customer.
 * Returns the reputation records sorted by timestamp (newest first).
 */
export const pollReputation = async (
  page,
  customerId,
  { minCount = 1, timeout = 90000 } = {},
) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const res = await page.request.post(
      'http://readmodel-orders/query/reputation/byCustomerId',
      {
        headers: { 'Content-Type': 'application/json' },
        data: { customerId },
      },
    );
    if (res.ok()) {
      const records = await res.json();
      if (records.length >= minCount) return records;
    }
    await page.waitForTimeout(2000);
  }
  return [];
};

/**
 * Map a reputation value to its auto-confirm threshold.
 */
export const reputationToThreshold = (reputation) =>
  reputation === 'good'
    ? 5000
    : reputation === 'poor'
      ? 0
      : 1000;

// ─── LLM panel helpers ───

/**
 * Get the LLM Assistant panel locator (the expanded panel with header).
 * The panel is a 350px-wide div containing the "LLM Assistant" header.
 */
export const getLlmPanel = (page) => {
  return page.locator('.w-\\[350px\\]');
};

/**
 * Get the collapsed LLM panel locator (the thin 50px-wide bar).
 */
export const getCollapsedPanel = (page) => {
  return page.locator('.w-\\[50px\\]');
};

/**
 * Ensure the LLM panel is expanded. If collapsed, click to expand.
 */
export const ensurePanelExpanded = async (page) => {
  const collapsed = getCollapsedPanel(page);
  if (await collapsed.isVisible()) {
    await collapsed.click();
  }
  await getLlmPanel(page).waitFor({ timeout: 10000 });
};

/**
 * Get the context label badge in the LLM panel header.
 * The label is a span with bg-blue-200 inside the bg-blue-50 header bar.
 * We scope to the header to avoid matching the "Analyze All Orders" button
 * which also has bg-blue-200.
 */
export const getContextLabel = (page) => {
  return getLlmPanel(page).locator('.bg-blue-50 .bg-blue-200');
};

/**
 * Type a message in the LLM panel input and send it.
 */
export const sendLlmMessage = async (page, text) => {
  const panel = getLlmPanel(page);
  const input = panel.locator('input[type="text"]');
  await input.fill(text);
  await panel.locator('button', { hasText: 'Send' }).click();
};

/**
 * Wait for the LLM panel to finish loading (no "Thinking..." indicator).
 */
export const waitForLlmResponse = async (page, timeout = 60000) => {
  const panel = getLlmPanel(page);
  // Wait for "Thinking..." to appear (indicating request started)
  try {
    await panel.getByText('Thinking...').waitFor({ timeout: 5000 });
  } catch {
    // May have already completed
  }
  // Wait for "Thinking..." to disappear (indicating response received)
  await expect(panel.getByText('Thinking...')).not.toBeVisible({
    timeout,
  });
};

/**
 * Switch to the Reputation tab and return the panel locator scoped to that tab.
 */
export const getReputationSection = async (page) => {
  const panel = getLlmPanel(page);
  await panel.locator('button', { hasText: 'Reputation' }).click();
  return panel;
};

/**
 * Wait for at least one reputation assessment card to appear in the Reputation tab.
 */
export const waitForReputationAssessment = async (page, timeout = 90000) => {
  const panel = getLlmPanel(page);
  await panel.locator('button', { hasText: 'Reputation' }).click();
  await expect(
    panel.locator('.bg-blue-50.text-xs .font-medium').first()
  ).toBeVisible({ timeout });
};

/**
 * Get the Quick Analysis section in the LLM panel.
 */
export const getQuickAnalysisSection = (page) => {
  return getLlmPanel(page).locator('text=Quick Analysis').locator('..');
};

/**
 * Select an analysis type from the Quick Analysis dropdown and run it.
 */
export const runQuickAnalysis = async (page, analysisType) => {
  const panel = getLlmPanel(page);
  const select = panel.locator('select');
  await select.selectOption(analysisType);
  // Click the analysis button (either "Analyze All Orders" or "Analyze <customer>")
  const analyzeButton = panel.locator('button', { hasText: /^Analyz/ });
  await analyzeButton.click();
};

/**
 * Wait for analysis results to appear in the LLM panel messages.
 * Analysis results appear inside .bg-blue-50 elements (AnalysisResults component).
 */
export const waitForAnalysisResults = async (page, timeout = 60000) => {
  // Wait for loading to finish
  await expect(
    getLlmPanel(page).locator('button', { hasText: 'Analyzing...' })
  ).not.toBeVisible({ timeout });
};

/**
 * Click the Explain button on a row in the customer or order table.
 */
export const clickExplainButton = async (page, rowText) => {
  const row = page.locator('tr', {
    has: page.getByText(rowText, { exact: true }),
  });
  await row.getByText('Explain').click();
};

/**
 * Wait for an explanation to appear in the LLM panel.
 * ExplanationDisplay renders inside a .border.rounded div with summary and explanation text.
 */
export const waitForExplanation = async (page, timeout = 60000) => {
  const panel = getLlmPanel(page);
  // Wait for loading state to clear
  // Explanation content renders in a div with whitespace-pre-wrap class
  await expect(
    panel.locator('.whitespace-pre-wrap')
  ).toBeVisible({ timeout });
};

// ─── Customer Service page helpers ───

/**
 * Send a query on the Customer Service page (separate from LLM panel).
 * The Customer Service page has its own input and message area.
 */
export const sendCustomerServiceQuery = async (page, text) => {
  const input = page.locator(
    'input[placeholder="Ask about customers and orders..."]'
  );
  await input.fill(text);
  // The Send button is next to the input
  await page
    .locator('button.bg-blue-500', { hasText: 'Send' })
    .click();
};

/**
 * Wait for a Customer Service response to appear.
 * Responses render in bg-gray-50 rounded-lg divs.
 */
export const waitForCustomerServiceResponse = async (page, timeout = 60000) => {
  // Wait for loading indicator to appear
  try {
    await page.getByText('Querying data...').waitFor({ timeout: 5000 });
  } catch {
    // May have already completed
  }
  // Wait for loading to finish
  await expect(page.getByText('Querying data...')).not.toBeVisible({
    timeout,
  });
};

/**
 * Get the tool call indicators in the Customer Service page.
 * ToolCallDisplay renders buttons with text like "Queried customers".
 */
export const getToolCallIndicators = (page) => {
  return page.locator('button', {
    hasText: /Queried (customers|orders|order statistics)/,
  });
};
