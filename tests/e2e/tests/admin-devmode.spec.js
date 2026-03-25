import { test, expect } from '@playwright/test';
import { waitForApp, createCustomer } from './helpers/app.js';
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
 * Navigate from the admin UI dashboard to the replay page for a given
 * read model. Handles stale replay state and T=0 dialog if present.
 */
const navigateToReplayPage = async (page, rmInfo) => {
  await page.getByRole('link', { name: 'Read Models' }).click();
  await page
    .getByRole('heading', { name: 'Read Models' })
    .waitFor();

  await page.getByText(rmInfo.name).first().waitFor();

  const row = findReadModelRow(page, rmInfo);
  await row.getByRole('link', { name: 'Replay' }).click();

  const configureStep = page.getByRole('heading', { name: 'Configure Replay' });
  const cancelButton = page.getByRole('button', { name: 'Cancel Replay' });
  const completeHeading = page.getByRole('heading', {
    name: 'Replay Complete',
  });
  const newReplayButton = page.getByRole('button', {
    name: 'Start New Replay',
  });
  const tzeroHeading = page.getByText('Fresh Read Model Detected');

  await expect(
    configureStep.or(cancelButton).or(completeHeading).or(tzeroHeading),
  ).toBeVisible();

  if (await cancelButton.isVisible()) {
    await cancelButton.click();
    await configureStep.waitFor();
  } else if (await completeHeading.isVisible()) {
    await newReplayButton.click();
    await configureStep.waitFor();
  } else if (await tzeroHeading.isVisible()) {
    // T=0 dialog detected — select first option and confirm
    const firstOption = page.locator('label').filter({
      hasText: 'Replay to current time',
    });
    await firstOption.click();
    await page.getByRole('button', { name: 'Confirm Selection' }).click();
    await page.getByText('T=0 option confirmed').waitFor();
  }
};

test.describe('Admin dev-mode features', () => {
  test.describe('T=0 preflight detection via API', () => {
    test('preflight returns valid response for active read model', async ({
      request,
      baseURL,
    }) => {
      const adminURL = getAdminURL(baseURL);
      const rmConfig = getReadModelConfig(baseURL);

      await waitForAdmin(request, adminURL);
      await ensureLive(request, rmConfig.customersOverview);

      const res = await request.get(
        `${adminURL}/admin/replay/preflight/${rmConfig.customersOverview.endpointName}/${rmConfig.customersOverview.name}`,
      );
      expect(res.ok()).toBe(true);

      const preflight = await res.json();
      expect(preflight.found).toBe(true);
      expect(typeof preflight.tzero).toBe('boolean');
      expect(typeof preflight.lastProjectedEventTimestamp).toBe('number');
      expect(preflight.state).toBe('live');
    });

    test('preflight returns 404 for unknown read model', async ({
      request,
      baseURL,
    }) => {
      const adminURL = getAdminURL(baseURL);
      await waitForAdmin(request, adminURL);

      const res = await request.get(
        `${adminURL}/admin/replay/preflight/nonexistent/unknown`,
      );
      expect(res.status()).toBe(404);
    });

    test('preflight returns tzero true for read model with no events', async ({
      request,
      baseURL,
    }) => {
      // In a fresh environment, the RM is live but has no projected events
      // Only reliable in the second pass (fresh devmode env)
      test.skip(!isDevMode, 'Requires fresh environment');

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
      // ordersOverview should be T=0 in a fresh env (no orders created yet)
      expect(preflight.tzero).toBe(true);
      expect(preflight.lastProjectedEventTimestamp).toBe(0);
    });
  });

  test.describe('dev-mode config endpoint', () => {
    test('admin config returns developmentMode flag', async ({
      request,
      baseURL,
    }) => {
      const adminURL = getAdminURL(baseURL);
      await waitForAdmin(request, adminURL);

      const res = await request.get(`${adminURL}/admin/config`);
      expect(res.ok()).toBe(true);

      const config = await res.json();
      expect(config.developmentMode).toBe(isDevMode);
    });

    test('validate-filter API endpoint works', async ({
      request,
      baseURL,
    }) => {
      const adminURL = getAdminURL(baseURL);
      await waitForAdmin(request, adminURL);

      // Valid filter
      const validRes = await request.post(
        `${adminURL}/admin/validate-filter`,
        { data: { filterString: "IncludeByName('test')" } },
      );
      expect(validRes.ok()).toBe(true);
      const validBody = await validRes.json();
      expect(validBody.error).toBeNull();

      // Invalid filter
      const invalidRes = await request.post(
        `${adminURL}/admin/validate-filter`,
        { data: { filterString: 'not a valid filter' } },
      );
      expect(invalidRes.ok()).toBe(true);
      const invalidBody = await invalidRes.json();
      expect(invalidBody.error).toBeTruthy();
    });
  });

  test.describe('dev-mode UI with DEVELOPMENT_MODE=false (default)', () => {
    test.skip(() => isDevMode, 'Skipped when DEVELOPMENT_MODE=true');

    test('dev-mode banner is not visible', async ({
      browser,
      request,
      baseURL,
    }) => {
      const adminURL = getAdminURL(baseURL);
      await waitForAdmin(request, adminURL);

      const page = await browser.newPage();
      try {
        await waitForAdminUI(page, adminURL);
        await expect(page.getByText('DEVELOPMENT MODE')).not.toBeVisible();
      } finally {
        await page.close();
      }
    });

    test('dev-mode controls are hidden on replay page', async ({
      browser,
      request,
      baseURL,
    }) => {
      const adminURL = getAdminURL(baseURL);
      const rmConfig = getReadModelConfig(baseURL);

      await ensureCleanReplayState(request, rmConfig.customersOverview);

      const page = await browser.newPage();
      try {
        await waitForAdmin(request, adminURL);
        await ensureLive(request, rmConfig.customersOverview);
        await waitForAdminUI(page, adminURL);
        await navigateToReplayPage(page, rmConfig.customersOverview);

        // Dev-mode overrides section should not be visible
        await expect(page.getByText('Dev-mode overrides')).not.toBeVisible();
      } finally {
        await page.close();
      }
    });
  });

  test.describe('dev-mode UI with DEVELOPMENT_MODE=true', () => {
    test.skip(() => !isDevMode, 'Requires DEVELOPMENT_MODE=true');

    test('dev-mode banner is visible', async ({
      browser,
      request,
      baseURL,
    }) => {
      const adminURL = getAdminURL(baseURL);
      await waitForAdmin(request, adminURL);

      const page = await browser.newPage();
      try {
        await waitForAdminUI(page, adminURL);
        await expect(page.getByText('DEVELOPMENT MODE')).toBeVisible();
      } finally {
        await page.close();
      }
    });

    test('DEV badge is visible in nav', async ({
      browser,
      request,
      baseURL,
    }) => {
      const adminURL = getAdminURL(baseURL);
      await waitForAdmin(request, adminURL);

      const page = await browser.newPage();
      try {
        await waitForAdminUI(page, adminURL);
        await expect(page.getByText('DEV', { exact: true })).toBeVisible();
      } finally {
        await page.close();
      }
    });

    test('T=0 dialog appears on replay page for fresh read model', async ({
      browser,
      request,
      baseURL,
    }) => {
      const adminURL = getAdminURL(baseURL);
      const rmConfig = getReadModelConfig(baseURL);

      // Use ordersOverview which has no events in a fresh env
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

    test('dev-mode overrides visible on replay page', async ({
      browser,
      request,
      baseURL,
    }) => {
      const adminURL = getAdminURL(baseURL);
      const rmConfig = getReadModelConfig(baseURL);

      await ensureCleanReplayState(request, rmConfig.customersOverview);

      const appPage = await browser.newPage();
      const adminPage = await browser.newPage();
      try {
        // Create test data so the RM has events (avoids T=0 dialog)
        await waitForApp(appPage, baseURL);
        await createCustomer(appPage, {
          name: `DevMode-${Date.now()}`,
          location: 'TestCity',
        });

        await waitForAdmin(request, adminURL);
        await ensureLive(request, rmConfig.customersOverview);
        await waitForAdminUI(adminPage, adminURL);
        await navigateToReplayPage(adminPage, rmConfig.customersOverview);

        // Dev-mode overrides section should be visible
        await expect(adminPage.getByText('Dev-mode overrides')).toBeVisible();
        // Side-effect checkbox should be visible
        await expect(
          adminPage.getByText('Enable side effects during replay'),
        ).toBeVisible();
      } finally {
        await appPage.close();
        await adminPage.close();
      }
    });

    test('filter field appears when side effects enabled', async ({
      browser,
      request,
      baseURL,
    }) => {
      const adminURL = getAdminURL(baseURL);
      const rmConfig = getReadModelConfig(baseURL);

      await ensureCleanReplayState(request, rmConfig.customersOverview);

      const appPage = await browser.newPage();
      const adminPage = await browser.newPage();
      try {
        // Create test data so the RM has events (avoids T=0 dialog)
        await waitForApp(appPage, baseURL);
        await createCustomer(appPage, {
          name: `DevFilter-${Date.now()}`,
          location: 'FilterCity',
        });

        await waitForAdmin(request, adminURL);
        await ensureLive(request, rmConfig.customersOverview);
        await waitForAdminUI(adminPage, adminURL);
        await navigateToReplayPage(adminPage, rmConfig.customersOverview);

        // Filter should not be visible initially
        await expect(
          adminPage.getByText('Side-effect filter (optional)'),
        ).not.toBeVisible();

        // Enable side effects checkbox
        await adminPage.getByText('Enable side effects during replay').click();

        // Filter field should now appear
        await expect(
          adminPage.getByText('Side-effect filter (optional)'),
        ).toBeVisible();
      } finally {
        await appPage.close();
        await adminPage.close();
      }
    });

    test('filter syntax help is available', async ({
      browser,
      request,
      baseURL,
    }) => {
      const adminURL = getAdminURL(baseURL);
      const rmConfig = getReadModelConfig(baseURL);

      await ensureCleanReplayState(request, rmConfig.customersOverview);

      const appPage = await browser.newPage();
      const adminPage = await browser.newPage();
      try {
        // Create test data so the RM has events (avoids T=0 dialog)
        await waitForApp(appPage, baseURL);
        await createCustomer(appPage, {
          name: `DevSyntax-${Date.now()}`,
          location: 'SyntaxCity',
        });

        await waitForAdmin(request, adminURL);
        await ensureLive(request, rmConfig.customersOverview);
        await waitForAdminUI(adminPage, adminURL);
        await navigateToReplayPage(adminPage, rmConfig.customersOverview);

        // Enable side effects
        await adminPage.getByText('Enable side effects during replay').click();

        // Verify syntax help is available
        await expect(adminPage.getByText('Syntax help')).toBeVisible();
        await adminPage.getByText('Syntax help').click();
        await expect(adminPage.getByText('IncludeByName')).toBeVisible();
        await expect(adminPage.getByText('ExcludeByName')).toBeVisible();
      } finally {
        await appPage.close();
        await adminPage.close();
      }
    });
  });
});
