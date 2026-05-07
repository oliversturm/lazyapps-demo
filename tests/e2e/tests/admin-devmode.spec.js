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
  isOrchestrated,
} from './helpers/admin.js';
import { execSync } from 'node:child_process';
import {
  killService,
  startService,
  waitForServiceHealthy,
  getProjectContainers,
} from './helpers/docker.js';

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

    // T=0 preflight test moved to admin-tzero.spec.js (must run before app tests)
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

    // T=0 UI tests moved to admin-tzero.spec.js (must run before app tests)

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

    test('side effects checkbox is included in replay execution', async ({
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
          name: `DevSideEffects-${Date.now()}`,
          location: 'SideEffectCity',
        });

        await waitForAdmin(request, adminURL);
        await ensureLive(request, rmConfig.customersOverview);
        await waitForAdminUI(adminPage, adminURL);
        await navigateToReplayPage(adminPage, rmConfig.customersOverview);

        // Enable side effects during replay
        await adminPage
          .getByText('Enable side effects during replay')
          .click();

        // Verify the side-effect filter section appeared
        await expect(
          adminPage.getByText('Side-effect filter (optional)'),
        ).toBeVisible();

        // Start replay with side effects enabled
        await adminPage
          .getByRole('button', { name: 'Start Replay' })
          .click();

        // Wait for replay to complete — side effects enabled during replay
        await expect(
          adminPage.getByRole('heading', { name: /Replay Complete/ }),
        ).toBeVisible();
      } finally {
        await appPage.close();
        await adminPage.close();
      }
    });

    test('activate without catch-up transitions RM to live', async ({
      browser,
      request,
      baseURL,
    }) => {
      const adminURL = getAdminURL(baseURL);
      const rmConfig = getReadModelConfig(baseURL);
      const rm = rmConfig.customersOverview;

      await ensureCleanReplayState(request, rm);

      const appPage = await browser.newPage();
      const adminPage = await browser.newPage();
      try {
        // Ensure RM has data and is live
        await waitForApp(appPage, baseURL);
        await createCustomer(appPage, {
          name: `DevActivate-${Date.now()}`,
          location: 'ActivateCity',
        });

        await waitForAdmin(request, adminURL);
        await ensureLive(request, rm);

        // Stop the RM via API so we can test activate without catch-up
        await request.post(
          `${rm.adminUrl}/admin/readmodel/stop/${rm.endpointName}/${rm.name}`,
        );

        // Poll until the RM is in idle state
        for (let i = 0; i < 30; i++) {
          const statusRes = await request.get(
            `${rm.adminUrl}/admin/readmodel/status/${rm.endpointName}/${rm.name}`,
          );
          const status = await statusRes.json();
          if (status.state === 'idle') break;
          await new Promise((r) => setTimeout(r, 300));
        }

        // Navigate to the RM detail page
        await waitForAdminUI(adminPage, adminURL);
        await adminPage
          .getByRole('link', { name: 'Read Models' })
          .click();
        await adminPage
          .getByRole('heading', { name: 'Read Models' })
          .waitFor();
        await adminPage.getByText(rm.name).first().waitFor();

        const row = findReadModelRow(adminPage, rm);
        await row
          .getByRole('link', { name: rm.name })
          .click();

        // Wait for the detail page with RM name heading
        await expect(
          adminPage.getByRole('heading', { name: rm.name }),
        ).toBeVisible();

        // The "Activate without Catch-up" button should be visible (dev mode + idle)
        const activateBtn = adminPage.getByRole('button', {
          name: 'Activate without Catch-up',
        });
        await expect(activateBtn).toBeVisible();

        // Click it
        await activateBtn.click();

        // Verify the RM transitions to live (via the status badge on the page)
        // Use the Stop button as evidence of live state — it only appears when live.
        // Avoids strict mode violation from getByText('live') matching badge + definition.
        await expect(
          adminPage.getByRole('button', { name: 'Stop' }),
        ).toBeVisible();
      } finally {
        // Ensure RM is live for subsequent tests
        await ensureLive(request, rm);
        await appPage.close();
        await adminPage.close();
      }
    });

    // Extended timeout: container kill + restart + health check takes 30-60s
    test('dismiss invalid state after crash recovery', async ({
      browser,
      request,
      baseURL,
    }) => {
      // Killing the monolith container kills everything — only works orchestrated
      test.skip(
        !isOrchestrated(baseURL),
        'Requires orchestrated mode for container control',
      );
      test.setTimeout(120000);

      const adminURL = getAdminURL(baseURL);
      const rmConfig = getReadModelConfig(baseURL);
      // Use ordersOverview (readmodel-orders) to avoid killing readmodel-customers,
      // which would break createCustomer in subsequent tests.
      const rm = rmConfig.ordersOverview;

      await ensureCleanReplayState(request, rm);

      const adminPage = await browser.newPage();
      try {
        await waitForAdmin(request, adminURL);
        await ensureLive(request, rm);

        // Simulate a crash with stale replayInProgress flag:
        // 1. Insert the flag directly into MongoDB (the replay may complete
        //    too fast to reliably kill mid-flight in the orchestrated setup)
        // 2. Kill the container so it restarts and detects the stale flag
        const mongoService =
          rm.service === 'monolith' ? 'mongo-monolith' : 'mongo';
        const mongoContainer = getProjectContainers().find(
          (c) => c.service === mongoService,
        );
        expect(mongoContainer).toBeTruthy();

        // Set replayInProgress flag in the readmodel's state collection.
        // The monolith uses a single 'monolith' database; orchestrated
        // services each have their own (e.g. 'readmodel-orders').
        const mongoDb =
          rm.service === 'monolith' ? 'monolith' : rm.service;
        const mongoCmd =
          `db.getSiblingDB("${mongoDb}")` +
          `.getCollection("readmodel.state")` +
          '.updateOne({name:"' + rm.name + '"},{$set:{replayInProgress:true}},{upsert:true})';
        execSync(
          `docker exec ${mongoContainer.id} mongosh --quiet --eval '${mongoCmd}'`,
          { encoding: 'utf-8', timeout: 10000 },
        );

        // SIGKILL the RM container (simulates crash, no graceful cleanup)
        killService(rm.service);

        // Restart the RM container
        startService(rm.service);

        // Wait for the container to be healthy
        const healthy = await waitForServiceHealthy(rm.service, 60000);
        expect(healthy).toBe(true);

        // Poll the RM service DIRECTLY for invalid state.
        let invalidDetected = false;
        for (let i = 0; i < 60; i++) {
          try {
            const res = await request.get(
              `${rm.serviceUrl}/admin/status/${rm.endpointName}/${rm.name}`,
            );
            if (res.ok()) {
              const status = await res.json();
              if (status.state === 'invalid') {
                invalidDetected = true;
                break;
              }
            }
          } catch {
            // Container may still be starting up
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
        expect(invalidDetected).toBe(true);

        // Restart admin-ui to clear its SSE cache. After the RM container
        // restart, the RM's stateVersion resets to 1, but admin-ui's cache
        // still holds the old (higher) version and silently rejects updates.
        // This is a known bug (stateVersion monotonicity assumption).
        killService('admin-ui');
        startService('admin-ui');
        const adminHealthy = await waitForServiceHealthy('admin-ui', 60000);
        expect(adminHealthy).toBe(true);

        // Navigate to the RM detail page in admin UI
        await waitForAdminUI(adminPage, adminURL);
        await adminPage
          .getByRole('link', { name: 'Read Models' })
          .click();
        await adminPage
          .getByRole('heading', { name: 'Read Models' })
          .waitFor();
        await adminPage.getByText(rm.name).first().waitFor();

        const row = findReadModelRow(adminPage, rm);
        await row.getByRole('link', { name: rm.name }).click();

        await expect(
          adminPage.getByRole('heading', { name: rm.name }),
        ).toBeVisible();

        // Verify the invalid state warning is displayed
        await expect(
          adminPage.getByRole('heading', { name: 'Invalid State' }),
        ).toBeVisible({ timeout: 10000 });

        // Click "Dismiss Invalid State" (dev-mode only)
        const dismissBtn = adminPage.getByRole('button', {
          name: 'Dismiss Invalid State',
        });
        await expect(dismissBtn).toBeVisible();
        await dismissBtn.click();

        // After dismissing, RM should transition to idle (Activate button appears)
        const activateBtn = adminPage.getByRole('button', {
          name: 'Activate',
          exact: true,
        });
        await expect(activateBtn).toBeVisible({ timeout: 5000 });

        // Activate to restore the RM for subsequent tests
        await activateBtn.click();
      } finally {
        // Ensure RM is live regardless of test outcome
        try {
          await ensureLive(request, rm);
        } catch {
          // Best effort — container might still be recovering
        }
        await adminPage.close();
      }
    });
  });
});
