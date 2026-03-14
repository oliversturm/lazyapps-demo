import { test, expect } from '@playwright/test';
import { getAdminURL, waitForAdmin } from './helpers/admin.js';

test.describe('Admin backup lifecycle', () => {
  test('create, list, and delete a backup', async ({ request, baseURL }) => {
    const adminURL = getAdminURL(baseURL);
    await waitForAdmin(request, adminURL);

    const readModel = 'customersOverview';
    const endpointName = 'monolith';

    // Create backup
    const createRes = await request.post(
      `${adminURL}/admin/backup/${endpointName}/${readModel}`,
      { data: {} },
    );
    expect(createRes.ok()).toBeTruthy();

    const backup = await createRes.json();
    expect(backup).toHaveProperty('backupId');

    const backupId = backup.backupId;

    // List backups — should contain the new one
    const listRes = await request.get(
      `${adminURL}/admin/backups/${endpointName}/${readModel}`,
    );
    expect(listRes.ok()).toBeTruthy();

    const backups = await listRes.json();
    expect(backups.some((b) => b.backupId === backupId)).toBeTruthy();

    // Delete the backup
    const deleteRes = await request.delete(
      `${adminURL}/admin/backup/${backupId}?readModelName=${readModel}&endpointName=${endpointName}`,
    );
    expect(deleteRes.status()).toBe(204);

    // Verify it is gone
    const listAfterRes = await request.get(
      `${adminURL}/admin/backups/${endpointName}/${readModel}`,
    );
    const backupsAfter = await listAfterRes.json();
    expect(backupsAfter.some((b) => b.backupId === backupId)).toBeFalsy();
  });

  test('returns 404 for unknown read model', async ({ request, baseURL }) => {
    const adminURL = getAdminURL(baseURL);
    await waitForAdmin(request, adminURL);

    const res = await request.post(
      `${adminURL}/admin/backup/_unknown/nonExistentModel`,
      { data: {} },
    );
    expect(res.status()).toBe(404);
  });
});
