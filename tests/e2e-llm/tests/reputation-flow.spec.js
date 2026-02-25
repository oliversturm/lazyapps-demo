import { test, expect } from '@playwright/test';
import {
  waitForApp,
  navigate,
  createCustomer,
  placeOrder,
  confirmOrder,
  declineOrder,
  getCustomerIdByName,
  pollReputation,
  reputationToThreshold,
  getLlmPanel,
  ensurePanelExpanded,
  waitForReputationAssessment,
} from './helpers/app.js';

test.describe('Reputation-based routing and reassessment', () => {
  test('S1: new customer - low-value order auto-confirms, high-value needs confirmation', async ({
    browser,
    baseURL,
  }) => {
    const unique = `${Date.now()}`;
    const customerName = `RepS1-${unique}`;
    const lowOrderText = `LowVal-${unique}`;
    const highOrderText = `HighVal-${unique}`;

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await waitForApp(page, baseURL);

      // Create a customer with no prior orders (no reputation history)
      await createCustomer(page, {
        name: customerName,
        location: 'TestCity',
      });

      // Place a low-value order ($500) — should auto-confirm
      // Default threshold (no reputation) is $1000
      await placeOrder(page, customerName, {
        text: lowOrderText,
        value: 500,
      });

      await navigate(page, 'Orders');
      const lowRow = page.locator('tr', {
        has: page.getByText(lowOrderText, { exact: true }),
      });
      await expect(
        lowRow.getByText('confirmed', { exact: true }),
      ).toBeVisible({ timeout: 30000 });

      // Place a high-value order ($2000) — should require confirmation
      await placeOrder(page, customerName, {
        text: highOrderText,
        value: 2000,
      });

      await navigate(page, 'Orders');
      const highRow = page.locator('tr', {
        has: page.getByText(highOrderText, { exact: true }),
      });
      await expect(
        highRow.getByText('unconfirmed', { exact: true }),
      ).toBeVisible({ timeout: 30000 });
    } finally {
      await context.close();
    }
  });

  test('S2: reputation-aware routing after reassessment', async ({
    browser,
    baseURL,
  }) => {
    const unique = `${Date.now()}`;
    const customerName = `RepS2-${unique}`;
    const order1Text = `Seed1-${unique}`;
    const order2Text = `Routed-${unique}`;

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await waitForApp(page, baseURL);

      await createCustomer(page, {
        name: customerName,
        location: 'ReputationCity',
      });

      // Place a large order that needs confirmation, then confirm it
      // to trigger reputation reassessment
      await placeOrder(page, customerName, {
        text: order1Text,
        value: 2000,
      });

      // Verify it's unconfirmed first
      await navigate(page, 'Orders');
      const row1 = page.locator('tr', {
        has: page.getByText(order1Text, { exact: true }),
      });
      await expect(
        row1.getByText('unconfirmed', { exact: true }),
      ).toBeVisible({ timeout: 30000 });

      // Confirm the order — this triggers reputation reassessment
      await confirmOrder(page, order1Text);

      // Wait for the reputation assessment to arrive
      const customerId = await getCustomerIdByName(page, customerName);
      expect(customerId).toBeTruthy();
      const repRecords = await pollReputation(page, customerId);
      expect(repRecords.length).toBeGreaterThanOrEqual(1);

      // Read the actual reputation the LLM assigned
      const latestReputation = repRecords[0].reputation;
      expect(['good', 'neutral', 'poor']).toContain(latestReputation);

      const threshold = reputationToThreshold(latestReputation);

      // Place a second order at a value below the threshold — should auto-confirm
      const safeValue = Math.max(1, threshold - 100);
      await placeOrder(page, customerName, {
        text: order2Text,
        value: safeValue,
      });

      await navigate(page, 'Orders');
      const row2 = page.locator('tr', {
        has: page.getByText(order2Text, { exact: true }),
      });

      if (threshold > 0) {
        // Value is below threshold, should auto-confirm
        await expect(
          row2.getByText('confirmed', { exact: true }),
        ).toBeVisible({ timeout: 30000 });
      } else {
        // Poor reputation (threshold = 0): all orders need confirmation
        await expect(
          row2.getByText('unconfirmed', { exact: true }),
        ).toBeVisible({ timeout: 30000 });
      }
    } finally {
      await context.close();
    }
  });

  test('S3: manual confirmation triggers reputation reassessment', async ({
    browser,
    baseURL,
  }) => {
    const unique = `${Date.now()}`;
    const customerName = `RepS3-${unique}`;
    const orderText = `Confirm-${unique}`;

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await waitForApp(page, baseURL);

      await createCustomer(page, {
        name: customerName,
        location: 'ConfirmCity',
      });

      // Place a large order that requires confirmation
      await placeOrder(page, customerName, {
        text: orderText,
        value: 2000,
      });

      // Verify unconfirmed
      await navigate(page, 'Orders');
      const row = page.locator('tr', {
        has: page.getByText(orderText, { exact: true }),
      });
      await expect(
        row.getByText('unconfirmed', { exact: true }),
      ).toBeVisible({ timeout: 30000 });

      // Confirm the order
      await confirmOrder(page, orderText);

      // Verify confirmed
      await navigate(page, 'Orders');
      const rowAfter = page.locator('tr', {
        has: page.getByText(orderText, { exact: true }),
      });
      await expect(
        rowAfter.getByText('confirmed', { exact: true }),
      ).toBeVisible({ timeout: 30000 });

      // Verify reputation reassessment was triggered — poll the API
      const customerId = await getCustomerIdByName(page, customerName);
      expect(customerId).toBeTruthy();
      const repRecords = await pollReputation(page, customerId);
      expect(repRecords.length).toBeGreaterThanOrEqual(1);

      // Validate the reputation record has expected structure
      const latest = repRecords[0];
      expect(['good', 'neutral', 'poor']).toContain(latest.reputation);
      expect(latest.reasoning).toBeTruthy();
      expect(latest.customerName).toBe(customerName);
    } finally {
      await context.close();
    }
  });

  test('S4: order decline changes status and triggers reputation reassessment', async ({
    browser,
    baseURL,
  }) => {
    const unique = `${Date.now()}`;
    const customerName = `RepS4-${unique}`;
    const orderText = `Decline-${unique}`;

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await waitForApp(page, baseURL);

      await createCustomer(page, {
        name: customerName,
        location: 'DeclineCity',
      });

      // Place a large order that requires confirmation
      await placeOrder(page, customerName, {
        text: orderText,
        value: 2000,
      });

      // Verify unconfirmed
      await navigate(page, 'Orders');
      const row = page.locator('tr', {
        has: page.getByText(orderText, { exact: true }),
      });
      await expect(
        row.getByText('unconfirmed', { exact: true }),
      ).toBeVisible({ timeout: 30000 });

      // Decline the order
      await declineOrder(page, orderText);

      // Verify status changed to declined on Orders page
      await navigate(page, 'Orders');
      const rowAfter = page.locator('tr', {
        has: page.getByText(orderText, { exact: true }),
      });
      await expect(
        rowAfter.getByText('declined', { exact: true }),
      ).toBeVisible({ timeout: 30000 });

      // Verify declined status on confirmation requests page too
      await navigate(page, 'Order Confirmation Requests');
      const confRow = page.locator('tr', {
        has: page.getByText(orderText, { exact: true }),
      });
      await expect(
        confRow.getByText('declined', { exact: true }),
      ).toBeVisible({ timeout: 30000 });

      // Verify reputation reassessment was triggered
      const customerId = await getCustomerIdByName(page, customerName);
      expect(customerId).toBeTruthy();
      const repRecords = await pollReputation(page, customerId);
      expect(repRecords.length).toBeGreaterThanOrEqual(1);

      const latest = repRecords[0];
      expect(['good', 'neutral', 'poor']).toContain(latest.reputation);
      expect(latest.reasoning).toBeTruthy();
    } finally {
      await context.close();
    }
  });

  test('S5: poor reputation makes all orders require confirmation', async ({
    browser,
    baseURL,
  }) => {
    const unique = `${Date.now()}`;
    const customerName = `RepS5-${unique}`;
    const declineText = `Declined-${unique}`;
    const cheapText = `Cheap-${unique}`;

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await waitForApp(page, baseURL);

      await createCustomer(page, {
        name: customerName,
        location: 'PoorRepCity',
      });

      // Place a large order and decline it to create a negative signal
      await placeOrder(page, customerName, {
        text: declineText,
        value: 2000,
      });

      await navigate(page, 'Orders');
      await expect(
        page
          .locator('tr', {
            has: page.getByText(declineText, { exact: true }),
          })
          .getByText('unconfirmed', { exact: true }),
      ).toBeVisible({ timeout: 30000 });

      await declineOrder(page, declineText);

      // Wait for reputation reassessment after decline
      const customerId = await getCustomerIdByName(page, customerName);
      expect(customerId).toBeTruthy();
      const repRecords = await pollReputation(page, customerId);
      expect(repRecords.length).toBeGreaterThanOrEqual(1);

      const reputation = repRecords[0].reputation;

      if (reputation === 'poor') {
        // Poor reputation: threshold is $0, so even a $1 order needs confirmation
        await placeOrder(page, customerName, {
          text: cheapText,
          value: 1,
        });

        await navigate(page, 'Orders');
        const cheapRow = page.locator('tr', {
          has: page.getByText(cheapText, { exact: true }),
        });
        await expect(
          cheapRow.getByText('unconfirmed', { exact: true }),
        ).toBeVisible({ timeout: 30000 });
      } else {
        // LLM did not assign "poor" reputation for a single decline.
        // Verify routing still uses the assessed reputation's threshold.
        const threshold = reputationToThreshold(reputation);
        const overThresholdValue = threshold + 500;

        await placeOrder(page, customerName, {
          text: cheapText,
          value: overThresholdValue,
        });

        await navigate(page, 'Orders');
        const cheapRow = page.locator('tr', {
          has: page.getByText(cheapText, { exact: true }),
        });
        await expect(
          cheapRow.getByText('unconfirmed', { exact: true }),
        ).toBeVisible({ timeout: 30000 });
      }
    } finally {
      await context.close();
    }
  });

  test('S6: reputation assessment shows in LLM panel after confirmation', async ({
    browser,
    baseURL,
  }) => {
    const unique = `${Date.now()}`;
    const customerName = `RepS6-${unique}`;
    const orderText = `PanelRep-${unique}`;

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await waitForApp(page, baseURL);

      await createCustomer(page, {
        name: customerName,
        location: 'PanelCity',
      });

      // Place a large order and confirm it to trigger reputation assessment
      await placeOrder(page, customerName, {
        text: orderText,
        value: 2000,
      });
      await confirmOrder(page, orderText);

      // Navigate to Orders page and check the LLM panel
      await navigate(page, 'Orders');
      await ensurePanelExpanded(page);

      // Switch to Reputation tab and wait for assessment data
      await waitForReputationAssessment(page);

      const panel = getLlmPanel(page);

      // Verify at least one assessment card exists
      const firstCard = panel
        .locator('.border.rounded.p-2.bg-blue-50')
        .first();
      await expect(firstCard).toBeVisible({ timeout: 10000 });

      // Verify it contains a valid reputation value
      await expect(firstCard).toContainText(/good|neutral|poor/, {
        timeout: 5000,
      });
    } finally {
      await context.close();
    }
  });

  test('S7: auto-confirm chain triggers reassessment with updated reasoning', async ({
    browser,
    baseURL,
  }) => {
    const unique = `${Date.now()}`;
    const customerName = `RepS7-${unique}`;
    const order1Text = `AutoConf1-${unique}`;
    const order2Text = `AutoConf2-${unique}`;

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await waitForApp(page, baseURL);

      // Create a fresh customer (no reputation history)
      await createCustomer(page, {
        name: customerName,
        location: 'AutoConfirmCity',
      });

      // Place a low-value order ($500) — should auto-confirm
      // Default threshold (no reputation) is $1000
      await placeOrder(page, customerName, {
        text: order1Text,
        value: 500,
      });

      // Verify order #1 auto-confirmed
      await navigate(page, 'Orders');
      const row1 = page.locator('tr', {
        has: page.getByText(order1Text, { exact: true }),
      });
      await expect(
        row1.getByText('confirmed', { exact: true }),
      ).toBeVisible({ timeout: 30000 });

      // Wait for first reputation reassessment (triggered by ORDER_CONFIRMED)
      const customerId = await getCustomerIdByName(page, customerName);
      expect(customerId).toBeTruthy();
      const firstRecords = await pollReputation(page, customerId, {
        minCount: 1,
      });
      expect(firstRecords.length).toBeGreaterThanOrEqual(1);

      const firstReasoning = firstRecords[0].reasoning;
      expect(firstReasoning).toBeTruthy();
      expect(['good', 'neutral', 'poor']).toContain(
        firstRecords[0].reputation,
      );

      // Place a second low-value order ($300) — should also auto-confirm
      await placeOrder(page, customerName, {
        text: order2Text,
        value: 300,
      });

      // Verify order #2 auto-confirmed
      await navigate(page, 'Orders');
      const row2 = page.locator('tr', {
        has: page.getByText(order2Text, { exact: true }),
      });
      await expect(
        row2.getByText('confirmed', { exact: true }),
      ).toBeVisible({ timeout: 30000 });

      // KEY ASSERTION: Poll for a SECOND reputation record.
      // Before the fix, the second reassessment was suppressed because
      // change detection only compared the reputation VALUE (e.g. 'neutral').
      // The stale reasoning bug meant no UPDATE_CUSTOMER_REPUTATION was
      // sent when reasoning changed but the value stayed the same.
      // With the fix, reasoning change detection produces a second record.
      const updatedRecords = await pollReputation(page, customerId, {
        minCount: 2,
      });
      expect(updatedRecords.length).toBeGreaterThanOrEqual(2);

      // Verify the latest reasoning reflects the updated order history
      // (2 orders instead of 1) and is not identical to the first
      const latestReasoning = updatedRecords[0].reasoning;
      expect(latestReasoning).toBeTruthy();
      expect(latestReasoning).not.toBe(firstReasoning);
      expect(['good', 'neutral', 'poor']).toContain(
        updatedRecords[0].reputation,
      );
    } finally {
      await context.close();
    }
  });
});
