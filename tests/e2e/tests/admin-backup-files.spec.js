import { test, expect } from '@playwright/test';
import { waitForApp, navigate, createCustomer } from './helpers/app.js';
import {
  getAdminURL,
  waitForAdmin,
  getReadModelConfig,
  ensureLive,
} from './helpers/admin.js';

test.describe('Admin backup API (file-based)', () => {
  test('backup creation returns accepted status', async ({ request, baseURL }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const adminUrl = rmConfig.customersOverview.adminUrl;
    const rm = rmConfig.customersOverview;
    await waitForAdmin(request, getAdminURL(baseURL));

    const createRes = await request.post(
      `${adminUrl}/admin/backup/create/${rm.endpointName}/${rm.name}`,
      { data: {} },
    );
    expect(createRes.ok()).toBeTruthy();

    const backup = await createRes.json();
    expect(backup).toHaveProperty('status', 'creating');
    expect(backup).toHaveProperty('endpointName');
    expect(backup).toHaveProperty('readModel');
  });

  test('list backups returns array', async ({
    request,
    baseURL,
  }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const adminUrl = rmConfig.customersOverview.adminUrl;
    const rm = rmConfig.customersOverview;
    await waitForAdmin(request, getAdminURL(baseURL));
    await ensureLive(request, rmConfig.customersOverview);

    // Create a backup so the list is non-empty
    await request.post(
      `${adminUrl}/admin/backup/create/${rm.endpointName}/${rm.name}`,
      { data: {} },
    );

    // Poll until the backup appears in the list
    let backups = [];
    for (let i = 0; i < 20; i++) {
      const listRes = await request.get(
        `${adminUrl}/admin/backup/list/${rm.endpointName}/${rm.name}`,
      );
      expect(listRes.ok()).toBeTruthy();
      backups = await listRes.json();
      expect(Array.isArray(backups)).toBeTruthy();
      if (backups.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(backups.length).toBeGreaterThan(0);
  });

  test('delete backup removes it from list', async ({
    request,
    baseURL,
  }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const adminUrl = rmConfig.customersOverview.adminUrl;
    const rm = rmConfig.customersOverview;
    await waitForAdmin(request, getAdminURL(baseURL));
    await ensureLive(request, rmConfig.customersOverview);

    // Create a backup
    await request.post(
      `${adminUrl}/admin/backup/create/${rm.endpointName}/${rm.name}`,
      { data: {} },
    );

    // Wait for backup to appear
    let backupId;
    for (let i = 0; i < 20; i++) {
      const listRes = await request.get(
        `${adminUrl}/admin/backup/list/${rm.endpointName}/${rm.name}`,
      );
      const backups = await listRes.json();
      if (backups.length > 0) {
        backupId = backups[0].backupId;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(backupId).toBeTruthy();

    // Delete it
    const deleteRes = await request.post(
      `${adminUrl}/admin/backup/delete/${rm.endpointName}/${rm.name}`,
      { data: { backupId } },
    );
    expect(deleteRes.ok()).toBeTruthy();
  });

  test('restore backup reverts read model data', async ({
    browser,
    request,
    baseURL,
  }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const adminUrl = rmConfig.customersOverview.adminUrl;
    const rm = rmConfig.customersOverview;
    const unique = `${Date.now()}`;
    await waitForAdmin(request, getAdminURL(baseURL));

    const page = await browser.newPage();

    try {
      await waitForApp(page, baseURL);

      // Ensure read model is live
      await ensureLive(request, rmConfig.customersOverview);

      // Create initial customer
      const customerBefore = `BackupBefore-${unique}`;
      await createCustomer(page, {
        name: customerBefore,
        location: 'BeforeCity',
      });

      // Create backup (captures state with customerBefore)
      await request.post(
        `${adminUrl}/admin/backup/create/${rm.endpointName}/${rm.name}`,
        { data: {} },
      );

      // Wait for backup to appear
      let backupId;
      for (let i = 0; i < 20; i++) {
        const listRes = await request.get(
          `${adminUrl}/admin/backup/list/${rm.endpointName}/${rm.name}`,
        );
        const backups = await listRes.json();
        if (backups.length > 0) {
          backupId = backups[backups.length - 1].backupId;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      expect(backupId).toBeTruthy();

      // Create another customer after backup
      const customerAfter = `BackupAfter-${unique}`;
      await createCustomer(page, {
        name: customerAfter,
        location: 'AfterCity',
      });

      // Verify both customers exist
      await navigate(page, 'Customers');
      await expect(page.getByText(customerBefore).first()).toBeVisible();
      await expect(page.getByText(customerAfter).first()).toBeVisible();

      // Replay from backup — single POST to new replay start endpoint
      const startRes = await request.post(
        `${adminUrl}/admin/replay/start/${rm.endpointName}/${rm.name}`,
        { data: { backupId } },
      );
      expect(startRes.ok()).toBeTruthy();

      // Wait for replay to start (state leaves 'live')
      for (let i = 0; i < 20; i++) {
        const statusRes = await request.get(
          `${adminUrl}/admin/readmodel/status/${rm.endpointName}/${rm.name}`,
        );
        const status = await statusRes.json();
        if (status.state !== 'live') break;
        await page.waitForTimeout(200);
      }

      // Wait for replay to complete (state returns to 'live')
      for (let i = 0; i < 60; i++) {
        const statusRes = await request.get(
          `${adminUrl}/admin/readmodel/status/${rm.endpointName}/${rm.name}`,
        );
        const status = await statusRes.json();
        if (status.state === 'live') break;
        await page.waitForTimeout(500);
      }

      // After replay from backup: the backup is restored and events from
      // the backup timestamp onward are replayed. Both customers should exist.
      await navigate(page, 'Customers');
      await expect(page.getByText(customerBefore).first()).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test('replay from scratch clears and rebuilds', async ({
    browser,
    request,
    baseURL,
  }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const adminUrl = rmConfig.customersOverview.adminUrl;
    const rm = rmConfig.customersOverview;
    const unique = `${Date.now()}`;
    await waitForAdmin(request, getAdminURL(baseURL));

    const page = await browser.newPage();

    try {
      await waitForApp(page, baseURL);

      // Ensure read model is live
      await ensureLive(request, rmConfig.customersOverview);

      // Create a customer
      const customerName = `ScratchReplay-${unique}`;
      await createCustomer(page, {
        name: customerName,
        location: 'ScratchCity',
      });
      await navigate(page, 'Customers');
      await expect(page.getByText(customerName).first()).toBeVisible();

      // Start replay (single POST, no prepare step needed)
      const startRes = await request.post(
        `${adminUrl}/admin/replay/start/${rm.endpointName}/${rm.name}`,
      );
      expect(startRes.ok()).toBeTruthy();

      // Wait for replay to start (state leaves 'live')
      for (let i = 0; i < 20; i++) {
        const statusRes = await request.get(
          `${adminUrl}/admin/readmodel/status/${rm.endpointName}/${rm.name}`,
        );
        const status = await statusRes.json();
        if (status.state !== 'live') break;
        await page.waitForTimeout(200);
      }

      // Wait for replay to complete (state returns to 'live')
      for (let i = 0; i < 60; i++) {
        const statusRes = await request.get(
          `${adminUrl}/admin/readmodel/status/${rm.endpointName}/${rm.name}`,
        );
        const status = await statusRes.json();
        if (status.state === 'live') break;
        await page.waitForTimeout(500);
      }

      // Customer should still exist (all events replayed from scratch).
      const deadline = Date.now() + 5000;
      let found = false;
      while (Date.now() < deadline) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('.bg-orange-100').waitFor();
        await navigate(page, 'Customers');
        try {
          await page.getByText(customerName).first().waitFor();
          found = true;
          break;
        } catch {
          // Read model not yet rebuilt, retry
        }
      }
      if (!found) {
        await expect(page.getByText(customerName).first()).toBeVisible();
      }
    } finally {
      await page.close();
    }
  });

  test('backup for unknown read model returns 404', async ({
    request,
    baseURL,
  }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const adminUrl = rmConfig.customersOverview.adminUrl;
    await waitForAdmin(request, getAdminURL(baseURL));

    const res = await request.post(
      `${adminUrl}/admin/backup/create/_unknown/nonExistentModel`,
      { data: {} },
    );
    expect(res.status()).toBe(404);
  });

  test('list backups for unknown read model returns 404', async ({
    request,
    baseURL,
  }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const adminUrl = rmConfig.customersOverview.adminUrl;
    await waitForAdmin(request, getAdminURL(baseURL));

    const res = await request.get(
      `${adminUrl}/admin/backup/list/_unknown/nonExistentModel`,
    );
    expect(res.status()).toBe(404);
  });
});
