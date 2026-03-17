import { test, expect } from '@playwright/test';
import { waitForApp, navigate, createCustomer } from './helpers/app.js';
import {
  getAdminURL,
  waitForAdmin,
  waitForAdminUI,
  getReadModelConfig,
  findReadModelRow,
  ensureLive,
} from './helpers/admin.js';

test.describe('Admin backup management via UI', () => {
  test('create and delete backup via admin UI', async ({
    browser,
    request,
    baseURL,
  }) => {
    const adminURL = getAdminURL(baseURL);
    const rmConfig = getReadModelConfig(baseURL);
    const unique = `${Date.now()}`;
    const customerName = `BackupUI-${unique}`;

    const appPage = await browser.newPage();
    const adminPage = await browser.newPage();

    try {
      await waitForApp(appPage, baseURL);
      await waitForAdmin(request, adminURL);

      // Ensure read model is live (auto-activation may not have completed yet)
      await ensureLive(request, rmConfig.customersOverview);

      // Create some data so the backup is meaningful
      await createCustomer(appPage, {
        name: customerName,
        location: 'BackupCity',
      });

      // Navigate to admin UI → Read Models → customersOverview → Backups
      await waitForAdminUI(adminPage, adminURL);

      await adminPage.getByRole('link', { name: 'Read Models' }).click();
      await adminPage
        .getByRole('heading', { name: 'Read Models' })
        .waitFor();
      await adminPage
        .getByText(rmConfig.customersOverview.name)
        .first()
        .waitFor();

      const row = findReadModelRow(adminPage, rmConfig.customersOverview);
      await row.getByRole('link', { name: 'Backups' }).click();

      // Verify we're on the backups page
      await adminPage
        .getByRole('heading', { name: /Backups:/ })
        .waitFor();

      // Create a backup
      await adminPage.getByRole('button', { name: 'Create Backup' }).click();

      // Backup creation is async — poll for the backup to appear.
      // Click Refresh until a Delete button shows up (backup listed).
      for (let i = 0; i < 10; i++) {
        await adminPage.waitForTimeout(500);
        await adminPage
          .getByRole('main')
          .getByRole('button', { name: 'Refresh' })
          .click();
        await adminPage.waitForTimeout(200);
        if (
          (await adminPage.getByRole('button', { name: 'Delete' }).count()) > 0
        )
          break;
      }
      await adminPage
        .getByRole('button', { name: 'Delete' })
        .first()
        .waitFor();

      // Verify the backup table has at least one row with a backup ID
      const backupTable = adminPage.locator('table');
      await expect(backupTable).toBeVisible();

      const backupRows = backupTable.locator('tbody tr');
      const rowCount = await backupRows.count();
      expect(rowCount).toBeGreaterThan(0);

      // Delete the backup we just created (last one in the list)
      const lastRow = backupRows.last();
      await lastRow.getByRole('button', { name: 'Delete' }).click();

      // If that was the only backup, "No backups available" should appear.
      // If there were others, the count should decrease.
      // Wait for the table to update
      await adminPage.waitForTimeout(500);

      const remainingRows = await backupRows.count();
      if (remainingRows === 0) {
        await expect(adminPage.getByText('No backups available')).toBeVisible();
      }
    } finally {
      await appPage.close();
      await adminPage.close();
    }
  });

  test('backup page accessible from read model detail', async ({
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

      // Navigate to Read Models → customersOverview detail
      await page.getByRole('link', { name: 'Read Models' }).click();
      await page
        .getByText(rmConfig.customersOverview.name)
        .first()
        .waitFor();

      const row = findReadModelRow(page, rmConfig.customersOverview);
      await row
        .getByRole('link', { name: rmConfig.customersOverview.name })
        .click();

      await page
        .getByRole('heading', { name: rmConfig.customersOverview.name })
        .waitFor();

      // Click Manage Backups
      await page.getByRole('link', { name: 'Manage Backups' }).click();

      // Verify we're on the backups page
      await expect(
        page.getByRole('heading', { name: /Backups:/ }),
      ).toBeVisible();

      // Verify Create Backup button is present
      await expect(
        page.getByRole('button', { name: 'Create Backup' }),
      ).toBeVisible();

      // Verify Refresh button is present (scope to main to avoid nav Refresh)
      await expect(
        page.getByRole('main').getByRole('button', { name: 'Refresh' }),
      ).toBeVisible();
    } finally {
      await page.close();
    }
  });
});
