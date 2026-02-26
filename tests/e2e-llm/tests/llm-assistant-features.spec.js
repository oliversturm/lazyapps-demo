import { test, expect } from '@playwright/test';
import {
  waitForApp,
  navigate,
  createCustomer,
  placeOrder,
  getLlmPanel,
  ensurePanelExpanded,
  sendLlmMessage,
  waitForLlmResponse,
  clickExplainButton,
  waitForExplanation,
  sendCustomerServiceQuery,
  waitForCustomerServiceResponse,
  getToolCallIndicators,
} from './helpers/app.js';

test.describe('LLM assistant features (F5, F6, F7)', () => {
  let unique;
  let customerName;
  let orderText;

  test.beforeEach(() => {
    unique = `${Date.now()}`;
    customerName = `AsstCust-${unique}`;
    orderText = `AsstOrder-${unique}`;
  });

  test('F5: Customer Service query with tool calls', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await waitForApp(page, baseURL);

      // Create a customer so there's data to query
      await createCustomer(page, {
        name: customerName,
        location: 'QueryCity',
      });

      // Navigate to Customer Service page
      await navigate(page, 'Customer Service');

      // Wait for the Customer Service page to load
      await expect(page.getByText('Customer Service')).toBeVisible({
        timeout: 10000,
      });

      // Ask a question
      await sendCustomerServiceQuery(page, 'Who are our customers?');

      // Wait for response
      await waitForCustomerServiceResponse(page);

      // Verify a response appeared (bg-gray-50 rounded-lg div from assistant)
      const assistantMessages = page.locator('.bg-gray-50.rounded-lg');
      await expect(assistantMessages.first()).toBeVisible({ timeout: 60000 });

      // Verify tool call indicators are present
      // ToolCallDisplay renders buttons like "Queried customers"
      const toolCalls = getToolCallIndicators(page);
      await expect(toolCalls.first()).toBeVisible({ timeout: 10000 });

      // Verify the response content is non-empty
      const responseContent = assistantMessages
        .first()
        .locator('.prose');
      await expect(responseContent).not.toHaveText('', { timeout: 10000 });
    } finally {
      await context.close();
    }
  });

  test('F6: LLM generates command preview and sending completes', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await waitForApp(page, baseURL);

      // Navigate to Customers page where LLM panel is visible
      await navigate(page, 'Customers');
      await ensurePanelExpanded(page);

      // Type a command-generating request in the LLM panel
      await sendLlmMessage(
        page,
        `Create a customer named TestCorp-${unique} in Berlin`
      );

      // Wait for LLM response
      await waitForLlmResponse(page);

      const panel = getLlmPanel(page);

      // Verify CommandPreview appeared — it renders in a .bg-amber-50 container
      await expect(panel.locator('.bg-amber-50')).toBeVisible({
        timeout: 60000,
      });

      // Verify at least one command is shown with a Send button
      const sendButton = panel
        .locator('.bg-amber-50 button', { hasText: 'Send' })
        .first();
      await expect(sendButton).toBeVisible({ timeout: 10000 });

      // Click Send and verify it completes or errors
      await sendButton.click();
      await expect(
        panel.locator('.bg-amber-50').getByText(/Sent|Error/)
      ).toBeVisible({ timeout: 30000 });
    } finally {
      await context.close();
    }
  });

  test('F7: explain button shows explanation in LLM panel', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await waitForApp(page, baseURL);

      // Create customer and order so there's data to explain
      await createCustomer(page, {
        name: customerName,
        location: 'ExplainCity',
      });
      await placeOrder(page, customerName, {
        text: orderText,
        value: 42,
      });

      // Navigate to Customers page and click Explain on the customer row
      await navigate(page, 'Customers');
      await ensurePanelExpanded(page);

      // Click Explain on the customer row
      await clickExplainButton(page, customerName);

      // Wait for explanation to appear in the LLM panel
      await waitForExplanation(page);

      const panel = getLlmPanel(page);

      // Verify explanation content is non-empty
      const explanationText = panel.locator('.whitespace-pre-wrap');
      await expect(explanationText).not.toHaveText('', { timeout: 10000 });
    } finally {
      await context.close();
    }
  });
});
