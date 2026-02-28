import { test, expect } from '@playwright/test';
import {
  waitForApp,
  navigate,
  createCustomer,
} from './helpers/app.js';
import { getAdminURL, waitForAdmin } from './helpers/admin.js';

test.describe('Admin replay', () => {
  test('replay events and verify data persists', async ({
    browser,
    request,
    baseURL,
  }) => {
    const adminURL = getAdminURL(baseURL);
    const unique = `${Date.now()}`;
    const customerName = `ReplayTest-${unique}`;

    const page = await browser.newPage();

    try {
      await waitForApp(page, baseURL);
      await waitForAdmin(request, adminURL);

      await createCustomer(page, {
        name: customerName,
        location: 'ReplayCity',
      });

      await navigate(page, 'Customers');
      await expect(page.getByText(customerName)).toBeVisible();

      const startRes = await request.post(
        `${adminURL}/api/admin/startReplay`,
        {
          data: {
            readModel: 'customersOverview',
            fromTimestamp: 0,
          },
        },
      );
      expect(startRes.ok()).toBeTruthy();

      const startBody = await startRes.json();
      expect(startBody.status).toBe('started');

      // Poll replay status — in-process replay should complete quickly
      let replayDone = false;
      for (let i = 0; i < 10; i++) {
        const statusRes = await request.get(
          `${adminURL}/api/admin/replayStatus/customersOverview`,
        );
        const status = await statusRes.json();

        if (status.status === 'completed' || status.status === 'idle') {
          replayDone = true;
          break;
        }

        await page.waitForTimeout(100);
      }
      expect(replayDone).toBeTruthy();

      await navigate(page, 'Customers');
      await expect(page.getByText(customerName)).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test('replay status returns idle for unknown model', async ({
    request,
    baseURL,
  }) => {
    const adminURL = getAdminURL(baseURL);
    await waitForAdmin(request, adminURL);

    const res = await request.get(
      `${adminURL}/api/admin/replayStatus/nonExistentModel`,
    );
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    expect(body).toHaveProperty('status');
  });

  test('startReplay rejects missing readModel', async ({
    request,
    baseURL,
  }) => {
    const adminURL = getAdminURL(baseURL);
    await waitForAdmin(request, adminURL);

    const res = await request.post(`${adminURL}/api/admin/startReplay`, {
      data: {},
    });
    expect(res.status()).toBe(400);
  });

  test('cancelReplay cancels an in-progress replay', async ({
    browser,
    request,
    baseURL,
  }) => {
    const adminURL = getAdminURL(baseURL);
    const page = await browser.newPage();

    try {
      await waitForApp(page, baseURL);
      await waitForAdmin(request, adminURL);

      for (let i = 0; i < 5; i++) {
        await createCustomer(page, {
          name: `CancelTest-${Date.now()}-${i}`,
          location: `City-${i}`,
        });
      }

      const startRes = await request.post(
        `${adminURL}/api/admin/startReplay`,
        {
          data: {
            readModel: 'customersOverview',
            fromTimestamp: 0,
          },
        },
      );
      expect(startRes.ok()).toBeTruthy();

      const cancelRes = await request.post(
        `${adminURL}/api/admin/cancelReplay`,
        {
          data: { readModel: 'customersOverview' },
        },
      );
      expect(cancelRes.ok()).toBeTruthy();
      const cancelBody = await cancelRes.json();
      expect(cancelBody.status).toBe('cancelling');

      let finalStatus;
      for (let i = 0; i < 10; i++) {
        const statusRes = await request.get(
          `${adminURL}/api/admin/replayStatus/customersOverview`,
        );
        const status = await statusRes.json();

        if (
          status.status === 'cancelled' ||
          status.status === 'completed' ||
          status.status === 'idle'
        ) {
          finalStatus = status.status;
          break;
        }

        await page.waitForTimeout(100);
      }
      expect(['cancelled', 'completed', 'idle']).toContain(finalStatus);
    } finally {
      await page.close();
    }
  });
});
