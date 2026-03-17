import { test, expect } from '@playwright/test';
import { getAdminURL, waitForAdmin, getReadModelConfig } from './helpers/admin.js';

test.describe('Admin backup lifecycle', () => {
  test('create, list, and delete a backup', async ({ request, baseURL }) => {
    const adminURL = getAdminURL(baseURL);
    const rmConfig = getReadModelConfig(baseURL);
    const rm = rmConfig.customersOverview;
    await waitForAdmin(request, adminURL);

    // Create backup
    const createRes = await request.post(
      `${adminURL}/admin/backup/create/${rm.endpointName}/${rm.name}`,
      { data: {} },
    );
    expect(createRes.ok()).toBeTruthy();

    const backup = await createRes.json();
    expect(backup).toHaveProperty('status', 'creating');

    // Poll for backup to appear in list
    let backups = [];
    for (let i = 0; i < 20; i++) {
      const listRes = await request.get(
        `${adminURL}/admin/backup/list/${rm.endpointName}/${rm.name}`,
      );
      backups = await listRes.json();
      if (backups.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(backups.length).toBeGreaterThan(0);

    const backupId = backups[0].backupId;

    // Delete the backup
    const deleteRes = await request.post(
      `${adminURL}/admin/backup/delete/${rm.endpointName}/${rm.name}`,
      { data: { backupId } },
    );
    expect(deleteRes.ok()).toBeTruthy();
  });

  test('returns 404 for unknown read model', async ({ request, baseURL }) => {
    const adminURL = getAdminURL(baseURL);
    await waitForAdmin(request, adminURL);

    const res = await request.post(
      `${adminURL}/admin/backup/create/_unknown/nonExistentModel`,
      { data: {} },
    );
    expect(res.status()).toBe(404);
  });
});
