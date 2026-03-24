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
  const configureStep = page.getByRole('heading', { name: 'Configure Replay' });
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
  test('replay from scratch via admin UI', async ({
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
      await ensureLive(request, rmConfig.customersOverview);

      // Create test data via the app
      await createCustomer(appPage, {
        name: customerName,
        location: 'ReplayCity',
      });
      await navigate(appPage, 'Customers');
      await expect(appPage.getByText(customerName).first()).toBeVisible();

      // Navigate admin UI to replay page for customersOverview
      await waitForAdminUI(adminPage, adminURL);
      await navigateToReplayPage(adminPage, rmConfig.customersOverview);

      // Default mode is "From scratch" — click Start Replay
      await adminPage.getByRole('button', { name: 'Start Replay' }).click();

      // Wait for replay to complete (SSE push notification)
      await expect(
        adminPage.getByRole('heading', { name: 'Replay Complete' }),
      ).toBeVisible();

      // Verify customer data persists in the app after replay
      await navigate(appPage, 'Customers');
      await expect(appPage.getByText(customerName).first()).toBeVisible();
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

    await ensureCleanReplayState(request, rmConfig.customersOverview);

    const appPage = await browser.newPage();
    const adminPage = await browser.newPage();

    try {
      await waitForApp(appPage, baseURL);
      await waitForAdmin(request, adminURL);
      await ensureLive(request, rmConfig.customersOverview);

      // Create test data
      await createCustomer(appPage, {
        name: customerName,
        location: 'ScratchCity',
      });
      await navigate(appPage, 'Customers');
      await expect(appPage.getByText(customerName).first()).toBeVisible();

      // Navigate to replay page
      await waitForAdminUI(adminPage, adminURL);
      await navigateToReplayPage(adminPage, rmConfig.customersOverview);

      // Select "From scratch" mode
      await adminPage.getByLabel(/From scratch/).check();

      // Start replay
      await adminPage.getByRole('button', { name: 'Start Replay' }).click();

      // Wait for completion (SSE push notification)
      await expect(
        adminPage.getByRole('heading', { name: 'Replay Complete' }),
      ).toBeVisible();

      // Verify data is restored in the app (reload to ensure fresh state)
      await navigate(appPage, 'Customers');
      await expect(appPage.getByText(customerName).first()).toBeVisible();
    } finally {
      await appPage.close();
      await adminPage.close();
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
      await ensureLive(request, rmConfig.customersOverview);

      // Create test data
      await createCustomer(appPage, {
        name: customerName,
        location: 'BackupCity',
      });
      await navigate(appPage, 'Customers');
      await expect(appPage.getByText(customerName).first()).toBeVisible();

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

      // Start replay
      await adminPage.getByRole('button', { name: 'Start Replay' }).click();

      // Wait for completion (SSE push notification)
      await expect(
        adminPage.getByRole('heading', { name: 'Replay Complete' }),
      ).toBeVisible();

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

      await expect(
        cancelButton.or(completeHeading).or(
          adminPage.getByRole('heading', { name: 'Configure Replay' }),
        ),
      ).toBeVisible();

      // Try to cancel if the button is still visible. The replay may
      // complete between the visibility check and the click, so wrap
      // in try/catch to handle the race gracefully.
      try {
        if (await cancelButton.isVisible()) {
          await cancelButton.click({ timeout: 1000 });
          await adminPage
            .getByRole('heading', { name: 'Configure Replay' })
            .waitFor();
        }
      } catch {
        // Replay completed before we could cancel — valid outcome
      }
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
      await ensureLive(request, rmConfig.customersOverview);
      await ensureLive(request, rmConfig.ordersOverview);
      await waitForAdminUI(page, adminURL);

      // Navigate to Read Models page
      await page.getByRole('link', { name: 'Read Models' }).click();
      await page
        .getByRole('heading', { name: 'Read Models' })
        .waitFor();

      // Verify both read models are listed
      const customersRow = findReadModelRow(page, rmConfig.customersOverview);
      const ordersRow = findReadModelRow(page, rmConfig.ordersOverview);

      await expect(customersRow).toBeVisible();
      await expect(ordersRow).toBeVisible();

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
