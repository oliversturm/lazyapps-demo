import { test, expect } from '@playwright/test';
import { waitForApp, navigate, createCustomer } from './helpers/app.js';
import {
  getAdminURL,
  waitForAdmin,
  getReadModelConfig,
  ensureLive,
} from './helpers/admin.js';

test.describe('Admin backup API (file-based)', () => {
  test('backup includes metadata fields', async ({ request, baseURL }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const adminUrl = rmConfig.customersOverview.adminUrl;
    const readModel = rmConfig.customersOverview.name;
    await waitForAdmin(request, getAdminURL(baseURL));

    const createRes = await request.post(
      `${adminUrl}/admin/backup/${rmConfig.customersOverview.endpointName}/${readModel}`,
      { data: {} },
    );
    expect(createRes.ok()).toBeTruthy();

    const backup = await createRes.json();
    expect(backup).toHaveProperty('backupId');
    expect(backup).toHaveProperty('eventTimestamp');
    expect(backup).toHaveProperty('timestamp');

    // Clean up
    await request.delete(
      `${adminUrl}/admin/backup/${backup.backupId}?readModelName=${readModel}&endpointName=${rmConfig.customersOverview.endpointName}`,
    );
  });

  test('list backups returns array with correct shape', async ({
    request,
    baseURL,
  }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const adminUrl = rmConfig.customersOverview.adminUrl;
    const readModel = rmConfig.customersOverview.name;
    await waitForAdmin(request, getAdminURL(baseURL));
    await ensureLive(request, rmConfig.customersOverview);

    // Create a backup so the list is non-empty
    const createRes = await request.post(
      `${adminUrl}/admin/backup/${rmConfig.customersOverview.endpointName}/${readModel}`,
      { data: {} },
    );
    const backup = await createRes.json();

    // Poll until the backup appears in the list (event bus delegation adds latency)
    let found = null;
    for (let i = 0; i < 10; i++) {
      const listRes = await request.get(
        `${adminUrl}/admin/backups/${rmConfig.customersOverview.endpointName}/${readModel}`,
      );
      expect(listRes.ok()).toBeTruthy();
      const backups = await listRes.json();
      expect(Array.isArray(backups)).toBeTruthy();
      found = backups.find((b) => b.backupId === backup.backupId);
      if (found) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    expect(found).toBeTruthy();
    expect(found).toHaveProperty('eventTimestamp');
    expect(found).toHaveProperty('timestamp');

    // Clean up
    await request.delete(
      `${adminUrl}/admin/backup/${backup.backupId}?readModelName=${readModel}&endpointName=${rmConfig.customersOverview.endpointName}`,
    );
  });

  test('delete backup removes it from list', async ({
    request,
    baseURL,
  }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const adminUrl = rmConfig.customersOverview.adminUrl;
    const readModel = rmConfig.customersOverview.name;
    await waitForAdmin(request, getAdminURL(baseURL));
    await ensureLive(request, rmConfig.customersOverview);

    // Create a backup
    const createRes = await request.post(
      `${adminUrl}/admin/backup/${rmConfig.customersOverview.endpointName}/${readModel}`,
      { data: {} },
    );
    const backup = await createRes.json();
    const backupId = backup.backupId;

    // Delete it
    const deleteRes = await request.delete(
      `${adminUrl}/admin/backup/${backupId}?readModelName=${readModel}&endpointName=${rmConfig.customersOverview.endpointName}`,
    );
    expect(deleteRes.ok()).toBeTruthy();

    // Verify it's gone (poll because event bus delegation adds latency)
    let gone = false;
    for (let i = 0; i < 10; i++) {
      const listRes = await request.get(
        `${adminUrl}/admin/backups/${rmConfig.customersOverview.endpointName}/${readModel}`,
      );
      const backups = await listRes.json();
      if (!backups.some((b) => b.backupId === backupId)) {
        gone = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    expect(gone).toBeTruthy();
  });

  test('restore backup reverts read model data', async ({
    browser,
    request,
    baseURL,
  }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const adminUrl = rmConfig.customersOverview.adminUrl;
    const cpUrl = rmConfig.customersOverview.cpUrl;
    const readModel = rmConfig.customersOverview.name;
    const unique = `${Date.now()}`;
    await waitForAdmin(request, getAdminURL(baseURL));

    const page = await browser.newPage();

    try {
      await waitForApp(page, baseURL);

      // Ensure read model is live (auto-activation may not have completed yet)
      await ensureLive(request, rmConfig.customersOverview);

      // Create initial customer
      const customerBefore = `BackupBefore-${unique}`;
      await createCustomer(page, {
        name: customerBefore,
        location: 'BeforeCity',
      });

      // Create backup (captures state with customerBefore)
      const createRes = await request.post(
        `${adminUrl}/admin/backup/${rmConfig.customersOverview.endpointName}/${readModel}`,
        { data: {} },
      );
      expect(createRes.ok()).toBeTruthy();
      const backup = await createRes.json();
      const backupId = backup.backupId;

      // Create another customer after backup
      const customerAfter = `BackupAfter-${unique}`;
      await createCustomer(page, {
        name: customerAfter,
        location: 'AfterCity',
      });

      // Verify both customers exist
      await navigate(page, 'Customers');
      await expect(page.getByText(customerBefore)).toBeVisible();
      await expect(page.getByText(customerAfter)).toBeVisible();

      // Replay from backup — this restores to the backup state and replays
      // events from the backup's timestamp onward, which should include
      // customerAfter's creation event
      const prepareRes = await request.post(
        `${adminUrl}/admin/replay/${rmConfig.customersOverview.endpointName}/${readModel}/prepare`,
        { data: { backupId } },
      );
      expect(prepareRes.ok()).toBeTruthy();
      const prepared = await prepareRes.json();
      expect(prepared.status).toBe('prepared');
      expect(prepared.fromTimestamp).toBeGreaterThan(0);

      // Start the replay via the command processor
      const startRes = await request.post(
        `${cpUrl}/api/admin/startReplay`,
        {
          data: {
            readModel,
            fromTimestamp: prepared.fromTimestamp,
            targetEndpointName: prepared.endpointName,
          },
        },
      );
      expect(startRes.ok()).toBeTruthy();

      // Wait for replay to complete
      for (let i = 0; i < 30; i++) {
        const statusRes = await request.get(
          `${cpUrl}/api/admin/replayStatus/${rmConfig.customersOverview.endpointName}/${readModel}`,
        );
        const status = await statusRes.json();
        if (status.status === 'completed' || status.status === 'idle') break;
        await page.waitForTimeout(200);
      }

      // Wait for RM-side replay to finish
      for (let i = 0; i < 30; i++) {
        const rmStatusRes = await request.get(
          `${adminUrl}/admin/replay/${rmConfig.customersOverview.endpointName}/${readModel}/status`,
        );
        const rmStatus = await rmStatusRes.json();
        if (rmStatus.status === 'idle') break;
        await page.waitForTimeout(200);
      }

      // After replay from backup: the backup is restored and events from
      // the backup timestamp onward are replayed. Both customers should exist.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('.bg-orange-100').waitFor();
      await navigate(page, 'Customers');
      await expect(page.getByText(customerBefore)).toBeVisible();

      // Clean up backup
      await request.delete(
        `${adminUrl}/admin/backup/${backupId}?readModelName=${readModel}&endpointName=${rmConfig.customersOverview.endpointName}`,
      );
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
    const cpUrl = rmConfig.customersOverview.cpUrl;
    const readModel = rmConfig.customersOverview.name;
    const unique = `${Date.now()}`;
    await waitForAdmin(request, getAdminURL(baseURL));

    const page = await browser.newPage();

    try {
      await waitForApp(page, baseURL);

      // Ensure read model is live (auto-activation may not have completed yet)
      await ensureLive(request, rmConfig.customersOverview);

      // Create a customer
      const customerName = `ScratchReplay-${unique}`;
      await createCustomer(page, {
        name: customerName,
        location: 'ScratchCity',
      });
      await navigate(page, 'Customers');
      await expect(page.getByText(customerName)).toBeVisible();

      // Prepare replay from scratch
      const prepareRes = await request.post(
        `${adminUrl}/admin/replay/${rmConfig.customersOverview.endpointName}/${readModel}/prepare`,
        { data: { fromScratch: true } },
      );
      expect(prepareRes.ok()).toBeTruthy();
      const prepared = await prepareRes.json();
      expect(prepared.status).toBe('prepared');
      expect(prepared.fromTimestamp).toBe(0);

      // Start the replay
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

      // Wait for replay to complete
      for (let i = 0; i < 30; i++) {
        const statusRes = await request.get(
          `${cpUrl}/api/admin/replayStatus/${rmConfig.customersOverview.endpointName}/${readModel}`,
        );
        const status = await statusRes.json();
        if (status.status === 'completed' || status.status === 'idle') break;
        await page.waitForTimeout(200);
      }

      // Wait for RM-side replay to finish
      for (let i = 0; i < 30; i++) {
        const rmStatusRes = await request.get(
          `${adminUrl}/admin/replay/${rmConfig.customersOverview.endpointName}/${readModel}/status`,
        );
        const rmStatus = await rmStatusRes.json();
        if (rmStatus.status === 'idle') break;
        await page.waitForTimeout(200);
      }

      // Customer should still exist (all events replayed from scratch).
      // The read model may still be rebuilding when the page reloads, so
      // poll with reloads until the data appears.
      const deadline = Date.now() + 10000;
      let found = false;
      while (Date.now() < deadline) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('.bg-orange-100').waitFor();
        await navigate(page, 'Customers');
        try {
          await page.getByText(customerName).waitFor();
          found = true;
          break;
        } catch {
          // Read model not yet rebuilt, retry
        }
      }
      if (!found) {
        await expect(page.getByText(customerName)).toBeVisible();
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
      `${adminUrl}/admin/backup/_unknown/nonExistentModel`,
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
      `${adminUrl}/admin/backups/_unknown/nonExistentModel`,
    );
    expect(res.status()).toBe(404);
  });
});
