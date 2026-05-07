import { test, expect } from '@playwright/test';
import {
  getAdminURL,
  waitForAdmin,
  waitForAdminUI,
  getReadModelConfig,
  findReadModelRow,
  ensureCleanReplayState,
  ensureLive,
} from './helpers/admin.js';

const isDevMode = process.env.DEVELOPMENT_MODE === 'true';

/**
 * T=0 tests must run BEFORE any app tests that create order events.
 * They rely on ordersOverview having lastProjectedEventTimestamp === 0,
 * which is only true when no order events exist in the event store.
 *
 * These tests are placed in a separate file so they can be matched by
 * early-running Playwright projects (tzero-monolith, tzero-orchestrated).
 */
test.describe('T=0 (fresh read model) detection and execution', () => {
  test('preflight returns tzero true for read model with no events', async ({
    request,
    baseURL,
  }) => {
    test.skip(!isDevMode, 'Requires fresh environment (DEVELOPMENT_MODE pass)');

    const adminURL = getAdminURL(baseURL);
    const rmConfig = getReadModelConfig(baseURL);

    await waitForAdmin(request, adminURL);
    await ensureLive(request, rmConfig.ordersOverview);

    const res = await request.get(
      `${adminURL}/admin/replay/preflight/${rmConfig.ordersOverview.endpointName}/${rmConfig.ordersOverview.name}`,
    );
    expect(res.ok()).toBe(true);

    const preflight = await res.json();
    expect(preflight.found).toBe(true);
    expect(preflight.tzero).toBe(true);
    expect(preflight.lastProjectedEventTimestamp).toBe(0);
  });

  test('T=0 dialog appears on replay page for fresh read model', async ({
    browser,
    request,
    baseURL,
  }) => {
    test.skip(!isDevMode, 'Requires DEVELOPMENT_MODE=true');

    const adminURL = getAdminURL(baseURL);
    const rmConfig = getReadModelConfig(baseURL);

    await ensureCleanReplayState(request, rmConfig.ordersOverview);

    const page = await browser.newPage();
    try {
      await waitForAdmin(request, adminURL);
      await ensureLive(request, rmConfig.ordersOverview);
      await waitForAdminUI(page, adminURL);

      // Navigate to replay page for ordersOverview
      await page.getByRole('link', { name: 'Read Models' }).click();
      await page
        .getByRole('heading', { name: 'Read Models' })
        .waitFor();
      await page.getByText(rmConfig.ordersOverview.name).first().waitFor();
      const row = findReadModelRow(page, rmConfig.ordersOverview);
      await row.getByRole('link', { name: 'Replay' }).click();

      // T=0 dialog should appear since no events have been projected
      await expect(
        page.getByText('Fresh Read Model Detected'),
      ).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test('T=0: replay to current time executes successfully', async ({
    browser,
    request,
    baseURL,
  }) => {
    test.skip(!isDevMode, 'Requires DEVELOPMENT_MODE=true');

    const adminURL = getAdminURL(baseURL);
    const rmConfig = getReadModelConfig(baseURL);
    const rm = rmConfig.ordersOverview;

    await ensureCleanReplayState(request, rm);

    const page = await browser.newPage();
    try {
      await waitForAdmin(request, adminURL);
      await ensureLive(request, rm);
      await waitForAdminUI(page, adminURL);

      // Navigate to replay page for ordersOverview (T=0 in fresh env)
      await page.getByRole('link', { name: 'Read Models' }).click();
      await page.getByRole('heading', { name: 'Read Models' }).waitFor();
      await page.getByText(rm.name).first().waitFor();
      const row = findReadModelRow(page, rm);
      await row.getByRole('link', { name: 'Replay' }).click();

      // T=0 dialog should appear
      await expect(
        page.getByText('Fresh Read Model Detected'),
      ).toBeVisible();

      // Select "Replay to current time" option
      await page
        .locator('label', { hasText: 'Replay to current time' })
        .click();

      // Confirm selection
      await page
        .getByRole('button', { name: 'Confirm Selection' })
        .click();

      // Modal confirmation
      await page
        .getByRole('button', { name: "Yes, I'm sure" })
        .click();

      // Green summary should appear
      await expect(
        page.getByText('T=0 option confirmed: Replay to current time'),
      ).toBeVisible();

      // Start replay
      await page
        .getByRole('button', { name: 'Start Replay' })
        .click();

      // Wait for replay to complete
      await expect(
        page.getByRole('heading', { name: /Replay Complete/ }),
      ).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test('T=0: skip replay catch-up only executes successfully', async ({
    browser,
    request,
    baseURL,
  }) => {
    test.skip(!isDevMode, 'Requires DEVELOPMENT_MODE=true');

    const adminURL = getAdminURL(baseURL);
    const rmConfig = getReadModelConfig(baseURL);
    const rm = rmConfig.ordersOverview;

    await ensureCleanReplayState(request, rm);

    const page = await browser.newPage();
    try {
      await waitForAdmin(request, adminURL);
      await ensureLive(request, rm);
      await waitForAdminUI(page, adminURL);

      // Navigate to replay page
      await page.getByRole('link', { name: 'Read Models' }).click();
      await page.getByRole('heading', { name: 'Read Models' }).waitFor();
      await page.getByText(rm.name).first().waitFor();
      const row = findReadModelRow(page, rm);
      await row.getByRole('link', { name: 'Replay' }).click();

      // T=0 dialog should appear
      await expect(
        page.getByText('Fresh Read Model Detected'),
      ).toBeVisible();

      // Select "Skip replay, catch-up only"
      await page
        .locator('label', { hasText: 'Skip replay, catch-up only' })
        .click();

      // Confirm selection
      await page
        .getByRole('button', { name: 'Confirm Selection' })
        .click();

      // Modal confirmation
      await page
        .getByRole('button', { name: "Yes, I'm sure" })
        .click();

      // Green summary
      await expect(
        page.getByText('T=0 option confirmed: Skip replay, catch-up only'),
      ).toBeVisible();

      // Button should say "Start Catch-up" for this mode
      await page
        .getByRole('button', { name: 'Start Catch-up' })
        .click();

      // Wait for completion
      await expect(
        page.getByRole('heading', { name: /Replay Complete/ }),
      ).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test('T=0: custom boundary timestamp executes successfully', async ({
    browser,
    request,
    baseURL,
  }) => {
    test.skip(!isDevMode, 'Requires DEVELOPMENT_MODE=true');

    const adminURL = getAdminURL(baseURL);
    const rmConfig = getReadModelConfig(baseURL);
    const rm = rmConfig.ordersOverview;

    await ensureCleanReplayState(request, rm);

    const page = await browser.newPage();
    try {
      await waitForAdmin(request, adminURL);
      await ensureLive(request, rm);
      await waitForAdminUI(page, adminURL);

      // Navigate to replay page
      await page.getByRole('link', { name: 'Read Models' }).click();
      await page.getByRole('heading', { name: 'Read Models' }).waitFor();
      await page.getByText(rm.name).first().waitFor();
      const row = findReadModelRow(page, rm);
      await row.getByRole('link', { name: 'Replay' }).click();

      // T=0 dialog should appear
      await expect(
        page.getByText('Fresh Read Model Detected'),
      ).toBeVisible();

      // Select "Custom boundary timestamp"
      await page
        .locator('label', { hasText: 'Custom boundary timestamp' })
        .click();

      // Timestamp entry should appear — fill with current time
      // The TimestampEntry component uses type="text" with inputmode="numeric"
      const timestampInput = page.locator('#ts-numeric');
      await timestampInput.waitFor();
      await timestampInput.fill(String(Date.now()));

      // Confirm selection
      await page
        .getByRole('button', { name: 'Confirm Selection' })
        .click();

      // Modal confirmation
      await page
        .getByRole('button', { name: "Yes, I'm sure" })
        .click();

      // Green summary
      await expect(
        page.getByText('T=0 option confirmed: Custom boundary timestamp'),
      ).toBeVisible();

      // Start replay
      await page
        .getByRole('button', { name: 'Start Replay' })
        .click();

      // Wait for completion
      await expect(
        page.getByRole('heading', { name: /Replay Complete/ }),
      ).toBeVisible();
    } finally {
      await page.close();
    }
  });
});
