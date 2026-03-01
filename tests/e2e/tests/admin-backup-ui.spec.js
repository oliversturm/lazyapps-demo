import { test, expect } from '@playwright/test';
import { waitForApp, navigate, createCustomer } from './helpers/app.js';
import {
  getAdminURL,
  waitForAdmin,
  waitForAdminUI,
  getReadModelConfig,
  findReadModelRow,
} from './helpers/admin.js';

test.describe('Admin backup management via UI', () => {
  test('create and delete backup via admin UI', async ({
    browser,
    request,
    baseURL,
  }) => {
    test.setTimeout(15000);

    const adminURL = getAdminURL(baseURL);
    const rmConfig = getReadModelConfig(baseURL);
    const unique = `${Date.now()}`;
    const customerName = `BackupUI-${unique}`;

    const appPage = await browser.newPage();
    const adminPage = await browser.newPage();

    try {
      await waitForApp(appPage, baseURL);
      await waitForAdmin(request, adminURL);

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
        .waitFor({ timeout: 2000 });
      await adminPage
        .getByText(rmConfig.customersOverview.name)
        .first()
        .waitFor({ timeout: 3000 });

      const row = findReadModelRow(adminPage, rmConfig.customersOverview);
      await row.getByRole('link', { name: 'Backups' }).click();

      // Verify we're on the backups page
      await adminPage
        .getByRole('heading', { name: /Backups:/ })
        .waitFor({ timeout: 2000 });

      // Create a backup
      await adminPage.getByRole('button', { name: 'Create Backup' }).click();

      // Wait for the backup to appear in the table (has a Delete button)
      await adminPage
        .getByRole('button', { name: 'Delete' })
        .first()
        .waitFor({ timeout: 5000 });

      // Verify the backup table has at least one row with a backup ID
      const backupTable = adminPage.locator('table');
      await expect(backupTable).toBeVisible({ timeout: 1000 });

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
        await expect(adminPage.getByText('No backups available')).toBeVisible({
          timeout: 2000,
        });
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
        .waitFor({ timeout: 3000 });

      const row = findReadModelRow(page, rmConfig.customersOverview);
      await row
        .getByRole('link', { name: rmConfig.customersOverview.name })
        .click();

      await page
        .getByRole('heading', { name: rmConfig.customersOverview.name })
        .waitFor({ timeout: 2000 });

      // Click Manage Backups
      await page.getByRole('link', { name: 'Manage Backups' }).click();

      // Verify we're on the backups page
      await expect(
        page.getByRole('heading', { name: /Backups:/ }),
      ).toBeVisible({ timeout: 2000 });

      // Verify Create Backup button is present
      await expect(
        page.getByRole('button', { name: 'Create Backup' }),
      ).toBeVisible();

      // Verify Refresh button is present
      await expect(
        page.getByRole('button', { name: 'Refresh' }),
      ).toBeVisible();
    } finally {
      await page.close();
    }
  });
});
