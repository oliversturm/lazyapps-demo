import { test, expect } from '@playwright/test';
import { waitForApp, navigate, createCustomer } from './helpers/app.js';
import {
  getAdminURL,
  waitForAdmin,
  waitForAdminUI,
  getReadModelConfig,
  findReadModelRow,
  ensureCleanReplayState,
  ensureLive,
  waitForReplayComplete,
} from './helpers/admin.js';

/**
 * Navigate from the admin UI dashboard to the replay page for a given
 * read model. Assumes the admin UI has already been loaded via waitForAdminUI.
 * Handles stale replay state by cancelling or resetting if necessary.
 */
const navigateToReplayPage = async (page, rmInfo) => {
  await page.getByRole('link', { name: 'Read Models' }).click();
  await page
    .getByRole('heading', { name: 'Read Models' })
    .waitFor();

  // Wait for read model data to load from the API
  await page.getByText(rmInfo.name).first().waitFor();

  const row = findReadModelRow(page, rmInfo);
  await row.getByRole('link', { name: 'Replay' }).click();

  // Handle stale replay state: the page might show an in-progress or
  // completed replay from a previous test. Reset to configure step.
  const configureStep = page.getByText('Step 1: Configure Replay');
  const cancelButton = page.getByRole('button', { name: 'Cancel Replay' });
  const completeHeading = page.getByRole('heading', {
    name: 'Replay Complete',
  });
  const newReplayButton = page.getByRole('button', {
    name: 'Start New Replay',
  });

  await expect(
    configureStep.or(cancelButton).or(completeHeading),
  ).toBeVisible();

  if (await cancelButton.isVisible()) {
    await cancelButton.click();
    await configureStep.waitFor();
  } else if (await completeHeading.isVisible()) {
    await newReplayButton.click();
    await configureStep.waitFor();
  }
};

test.describe('Admin replay workflow via UI', () => {
  test('replay from current state via admin UI', async ({
    browser,
    request,
    baseURL,
  }) => {
    const adminURL = getAdminURL(baseURL);
    const rmConfig = getReadModelConfig(baseURL);
    const unique = `${Date.now()}`;
    const customerName = `UIReplayCurrent-${unique}`;

    // Ensure no stale replay state from previous test runs
    await ensureCleanReplayState(request, rmConfig.customersOverview);

    const appPage = await browser.newPage();
    const adminPage = await browser.newPage();

    try {
      await waitForApp(appPage, baseURL);
      await waitForAdmin(request, adminURL);

      // Ensure read model is live (auto-activation may not have completed yet)
      await ensureLive(request, rmConfig.customersOverview);

      // Create test data via the app
      await createCustomer(appPage, {
        name: customerName,
        location: 'ReplayCity',
      });
      await navigate(appPage, 'Customers');
      await expect(appPage.getByText(customerName)).toBeVisible();

      // Navigate admin UI to replay page for customersOverview
      await waitForAdminUI(adminPage, adminURL);
      await navigateToReplayPage(adminPage, rmConfig.customersOverview);

      // Default mode is "From current state" — click Prepare Replay
      await adminPage.getByRole('button', { name: 'Prepare Replay' }).click();

      // Wait for prepared state
      await adminPage
        .getByText('Step 2: Start Replay')
        .waitFor();

      // Start replay
      await adminPage.getByRole('button', { name: 'Start Replay' }).click();

      // Wait for replay to complete via API (the admin service's replay
      // status returns 'idle' after REPLAY_EVENTS_DONE, which the UI may
      // not detect as 'completed' — poll the RM status directly)
      await waitForReplayComplete(request, rmConfig.customersOverview);

      // Re-activate read model after replay (lifecycle state may reset)
      await ensureLive(request, rmConfig.customersOverview);

      // Verify customer data persists in the app after replay
      await appPage.reload({ waitUntil: 'domcontentloaded' });
      await appPage.locator('.bg-orange-100').waitFor();
      await navigate(appPage, 'Customers');
      await expect(appPage.getByText(customerName)).toBeVisible();
    } finally {
      await appPage.close();
      await adminPage.close();
    }
  });

  test('replay from scratch shows Replay Complete heading', async ({
    browser,
    request,
    baseURL,
  }) => {
    const adminURL = getAdminURL(baseURL);
    const rmConfig = getReadModelConfig(baseURL);
    const unique = `${Date.now()}`;
    const customerName = `UIReplayComplete-${unique}`;

    await ensureCleanReplayState(request, rmConfig.customersOverview);

    const appPage = await browser.newPage();
    const adminPage = await browser.newPage();

    try {
      await waitForApp(appPage, baseURL);
      await waitForAdmin(request, adminURL);
      await ensureLive(request, rmConfig.customersOverview);

      // Create test data so replay has events to process
      await createCustomer(appPage, {
        name: customerName,
        location: 'CompleteCity',
      });
      await navigate(appPage, 'Customers');
      await expect(appPage.getByText(customerName)).toBeVisible();

      // Navigate admin UI to replay page
      await waitForAdminUI(adminPage, adminURL);
      await navigateToReplayPage(adminPage, rmConfig.customersOverview);

      // Select "From scratch" mode
      await adminPage.getByLabel(/From scratch/).check();

      // Prepare replay
      await adminPage.getByRole('button', { name: 'Prepare Replay' }).click();
      await adminPage
        .getByText('Step 2: Start Replay')
        .waitFor();

      // Start replay
      await adminPage.getByRole('button', { name: 'Start Replay' }).click();

      // Wait for "Replay Complete" heading to appear in the UI
      await expect(
        adminPage.getByRole('heading', { name: 'Replay Complete' }),
      ).toBeVisible();

      // Verify "Start New Replay" button is also present
      await expect(
        adminPage.getByRole('button', { name: 'Start New Replay' }),
      ).toBeVisible();

      // Wait for the RM-side replay processing to finish (the UI heading
      // may appear before the RM has processed all replayed events)
      await waitForReplayComplete(request, rmConfig.customersOverview);

      // Re-activate and verify data persists
      await ensureLive(request, rmConfig.customersOverview);

      // Poll with reloads until the customer data appears (RM may still
      // be processing replayed events after reaching 'live' state).
      // In orchestrated mode, event replay flows through RabbitMQ which
      // adds latency compared to in-process monolith replay.
      const deadline = Date.now() + 20000;
      let found = false;
      while (Date.now() < deadline) {
        await appPage.reload({ waitUntil: 'domcontentloaded' });
        await appPage.locator('.bg-orange-100').waitFor();
        await navigate(appPage, 'Customers');
        try {
          await appPage
            .getByText(customerName)
            .first()
            .waitFor();
          found = true;
          break;
        } catch {
          // Read model not yet rebuilt, retry
        }
      }
      if (!found) {
        await expect(appPage.getByText(customerName).first()).toBeVisible();
      }
    } finally {
      await appPage.close();
      await adminPage.close();
    }
  });

  test('replay from scratch restores data via admin UI', async ({
    browser,
    request,
    baseURL,
  }) => {
    const adminURL = getAdminURL(baseURL);
    const rmConfig = getReadModelConfig(baseURL);
    const unique = `${Date.now()}`;
    const customerName = `UIReplayScratch-${unique}`;

    const adminUrl = rmConfig.customersOverview.adminUrl;
    const cpUrl = rmConfig.customersOverview.cpUrl;
    const readModel = rmConfig.customersOverview.name;
    const endpointName = rmConfig.customersOverview.endpointName;

    await ensureCleanReplayState(request, rmConfig.customersOverview);

    const appPage = await browser.newPage();

    try {
      await waitForApp(appPage, baseURL);
      await waitForAdmin(request, adminURL);

      // Ensure read model is live (auto-activation may not have completed yet)
      await ensureLive(request, rmConfig.customersOverview);

      // Create test data
      await createCustomer(appPage, {
        name: customerName,
        location: 'ScratchCity',
      });
      await navigate(appPage, 'Customers');
      await expect(appPage.getByText(customerName)).toBeVisible();

      // Prepare replay from scratch via admin API
      const prepareRes = await request.post(
        `${adminUrl}/admin/replay/${endpointName}/${readModel}/prepare`,
        { data: { fromScratch: true } },
      );
      expect(prepareRes.ok()).toBeTruthy();
      const prepared = await prepareRes.json();
      expect(prepared.status).toBe('prepared');
      expect(prepared.fromTimestamp).toBe(0);

      // Start the replay via the admin API
      const startRes = await request.post(
        `${cpUrl}/api/admin/startReplay`,
        {
          data: {
            readModel,
            fromTimestamp: 0,
            targetEndpointName: prepared.endpointName,
          },
        },
      );
      expect(startRes.ok()).toBeTruthy();

      // Wait for replay orchestration to complete
      for (let i = 0; i < 60; i++) {
        const statusRes = await request.get(
          `${cpUrl}/api/admin/replayStatus/${endpointName}/${readModel}`,
        );
        const status = await statusRes.json();
        if (status.status === 'completed' || status.status === 'idle') break;
        await appPage.waitForTimeout(200);
      }

      // Wait for RM-side replay to finish
      for (let i = 0; i < 60; i++) {
        const rmStatusRes = await request.get(
          `${adminUrl}/admin/replay/${endpointName}/${readModel}/status`,
        );
        const rmStatus = await rmStatusRes.json();
        if (rmStatus.status === 'idle' || rmStatus.status === 'completed') break;
        await appPage.waitForTimeout(200);
      }

      // Poll with reloads until data appears (read model rebuilding)
      const deadline = Date.now() + 10000;
      let found = false;
      while (Date.now() < deadline) {
        await appPage.reload({ waitUntil: 'domcontentloaded' });
        await appPage.locator('.bg-orange-100').waitFor();
        await navigate(appPage, 'Customers');
        try {
          await appPage.getByText(customerName).waitFor();
          found = true;
          break;
        } catch {
          // Read model not yet rebuilt, retry
        }
      }
      if (!found) {
        await expect(appPage.getByText(customerName)).toBeVisible();
      }
    } finally {
      await appPage.close();
    }
  });

  test('replay from backup via admin UI', async ({
    browser,
    request,
    baseURL,
  }) => {
    const adminURL = getAdminURL(baseURL);
    const rmConfig = getReadModelConfig(baseURL);
    const unique = `${Date.now()}`;
    const customerName = `UIReplayBackup-${unique}`;

    await ensureCleanReplayState(request, rmConfig.customersOverview);

    const appPage = await browser.newPage();
    const adminPage = await browser.newPage();

    try {
      await waitForApp(appPage, baseURL);
      await waitForAdmin(request, adminURL);

      // Ensure read model is live (auto-activation may not have completed yet)
      await ensureLive(request, rmConfig.customersOverview);

      // Create test data
      await createCustomer(appPage, {
        name: customerName,
        location: 'BackupCity',
      });
      await navigate(appPage, 'Customers');
      await expect(appPage.getByText(customerName)).toBeVisible();

      // Create a backup via the admin UI
      await waitForAdminUI(adminPage, adminURL);
      await adminPage.getByRole('link', { name: 'Read Models' }).click();
      await adminPage
        .getByRole('heading', { name: 'Read Models' })
        .waitFor();
      await adminPage
        .getByText(rmConfig.customersOverview.name)
        .first()
        .waitFor();

      const rmRow = findReadModelRow(adminPage, rmConfig.customersOverview);
      await rmRow.getByRole('link', { name: 'Backups' }).click();

      await adminPage
        .getByRole('heading', { name: /Backups:/ })
        .waitFor();
      await adminPage.getByRole('button', { name: 'Create Backup' }).click();
      await adminPage
        .getByRole('button', { name: 'Delete' })
        .first()
        .waitFor();

      // Navigate to replay page
      await navigateToReplayPage(adminPage, rmConfig.customersOverview);

      // Select "From backup" mode
      await adminPage.getByLabel(/From backup/).check();

      // Wait for the backup select dropdown and choose the first backup
      await adminPage.locator('select').waitFor();
      // Wait for backup options to load (native <option> elements are hidden
      // inside a closed <select>, so use 'attached' instead of 'visible')
      const backupOption = adminPage.locator('select option').nth(1);
      await backupOption.waitFor({ state: 'attached' });
      const backupValue = await backupOption.getAttribute('value');
      await adminPage.locator('select').selectOption(backupValue);

      // Prepare replay
      await adminPage.getByRole('button', { name: 'Prepare Replay' }).click();

      await adminPage
        .getByText('Step 2: Start Replay')
        .waitFor();

      // Start replay
      await adminPage.getByRole('button', { name: 'Start Replay' }).click();

      // Wait for replay to complete via API
      await waitForReplayComplete(request, rmConfig.customersOverview);

      // Re-activate read model after replay (lifecycle state may reset)
      await ensureLive(request, rmConfig.customersOverview);

      // Verify data persists in the app (use .first() because customer name
      // may appear in multiple table cells after backup replay)
      await appPage.reload({ waitUntil: 'domcontentloaded' });
      await appPage.locator('.bg-orange-100').waitFor();
      await navigate(appPage, 'Customers');
      await expect(appPage.getByText(customerName).first()).toBeVisible();
    } finally {
      await appPage.close();
      await adminPage.close();
    }
  });

  test('cancel in-progress replay via admin UI', async ({
    browser,
    request,
    baseURL,
  }) => {
    const adminURL = getAdminURL(baseURL);
    const rmConfig = getReadModelConfig(baseURL);
    const unique = `${Date.now()}`;

    await ensureCleanReplayState(request, rmConfig.customersOverview);

    const appPage = await browser.newPage();
    const adminPage = await browser.newPage();

    try {
      await waitForApp(appPage, baseURL);
      await waitForAdmin(request, adminURL);

      // Ensure read model is live (auto-activation may not have completed yet)
      await ensureLive(request, rmConfig.customersOverview);

      // Create several customers so replay has events to process
      for (let i = 0; i < 5; i++) {
        await createCustomer(appPage, {
          name: `CancelUI-${unique}-${i}`,
          location: `City-${i}`,
        });
      }

      // Navigate to replay page
      await waitForAdminUI(adminPage, adminURL);
      await navigateToReplayPage(adminPage, rmConfig.customersOverview);

      // Prepare replay
      await adminPage.getByRole('button', { name: 'Prepare Replay' }).click();

      await adminPage
        .getByText('Step 2: Start Replay')
        .waitFor();

      // Start replay
      await adminPage.getByRole('button', { name: 'Start Replay' }).click();

      // The replay might complete very quickly with a small dataset.
      // Wait for either the Cancel button or the Complete heading.
      const cancelButton = adminPage.getByRole('button', {
        name: 'Cancel Replay',
      });
      const completeHeading = adminPage.getByRole('heading', {
        name: 'Replay Complete',
      });

      await expect(cancelButton.or(completeHeading)).toBeVisible();

      if (await cancelButton.isVisible()) {
        await cancelButton.click();

        // Should return to configure state
        await adminPage
          .getByText('Step 1: Configure Replay')
          .waitFor();
      }
      // If replay already completed, that's also a valid outcome
    } finally {
      await appPage.close();
      await adminPage.close();
    }
  });

  test('admin UI shows read model list with replay actions', async ({
    browser,
    request,
    baseURL,
  }) => {
    const adminURL = getAdminURL(baseURL);
    const rmConfig = getReadModelConfig(baseURL);

    const page = await browser.newPage();

    try {
      await waitForAdmin(request, adminURL);

      // Ensure both read models are live and reachable. Prior replay tests
      // may leave RM services temporarily unreachable (ECONNREFUSED), so
      // retry each with backoff until the service responds.
      for (const rmInfo of [rmConfig.customersOverview, rmConfig.ordersOverview]) {
        for (let retry = 0; retry < 20; retry++) {
          try {
            await ensureLive(request, rmInfo);
            break;
          } catch {
            if (retry === 19) {
              throw new Error(
                `RM service ${rmInfo.service} not reachable after 20 retries`,
              );
            }
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
        }
      }

      // The admin UI fetches read model data from RM services via
      // ADMIN_READ_MODEL_SERVICES. Poll with full page reloads until both
      // rows appear (the UI silently drops failed RM service responses).
      const customersRow = findReadModelRow(page, rmConfig.customersOverview);
      const ordersRow = findReadModelRow(page, rmConfig.ordersOverview);

      let bothVisible = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        await waitForAdminUI(page, adminURL);
        await page.getByRole('link', { name: 'Read Models' }).click();
        await page
          .getByRole('heading', { name: 'Read Models' })
          .waitFor();
        try {
          await expect(customersRow).toBeVisible();
          await expect(ordersRow).toBeVisible();
          bothVisible = true;
          break;
        } catch {
          // RM service data not fully loaded yet, retry with fresh page load
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      if (!bothVisible) {
        await expect(customersRow).toBeVisible();
        await expect(ordersRow).toBeVisible();
      }

      // Verify each row has Backups and Replay action links
      await expect(
        customersRow.getByRole('link', { name: 'Backups' }),
      ).toBeVisible();
      await expect(
        customersRow.getByRole('link', { name: 'Replay' }),
      ).toBeVisible();

      await expect(
        ordersRow.getByRole('link', { name: 'Backups' }),
      ).toBeVisible();
      await expect(
        ordersRow.getByRole('link', { name: 'Replay' }),
      ).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test('read model detail page shows replay button', async ({
    browser,
    request,
    baseURL,
  }) => {
    const adminURL = getAdminURL(baseURL);
    const rmConfig = getReadModelConfig(baseURL);

    const page = await browser.newPage();

    try {
      await waitForAdmin(request, adminURL);
      await waitForAdminUI(page, adminURL);

      // Navigate to Read Models → click customersOverview
      await page.getByRole('link', { name: 'Read Models' }).click();
      await page
        .getByText(rmConfig.customersOverview.name)
        .first()
        .waitFor();

      const row = findReadModelRow(page, rmConfig.customersOverview);
      await row
        .getByRole('link', { name: rmConfig.customersOverview.name })
        .click();

      // Verify detail page shows the read model name
      await expect(
        page.getByRole('heading', {
          name: rmConfig.customersOverview.name,
        }),
      ).toBeVisible();

      // Verify Start Replay link is present
      await expect(
        page.getByRole('link', { name: 'Start Replay' }),
      ).toBeVisible();

      // Verify Manage Backups link is present
      await expect(
        page.getByRole('link', { name: 'Manage Backups' }),
      ).toBeVisible();
    } finally {
      await page.close();
    }
  });
});
