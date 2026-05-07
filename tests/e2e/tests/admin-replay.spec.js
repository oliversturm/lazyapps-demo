import { test, expect } from '@playwright/test';
import {
  waitForApp,
  navigate,
  createCustomer,
} from './helpers/app.js';
import {
  getAdminURL,
  waitForAdmin,
  getReadModelConfig,
  ensureLive,
} from './helpers/admin.js';

test.describe('Admin replay', () => {
  test('replay events and verify data persists', async ({
    browser,
    request,
    baseURL,
  }) => {
    const adminURL = getAdminURL(baseURL);
    const rmConfig = getReadModelConfig(baseURL);
    const rm = rmConfig.customersOverview;
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
        `${adminURL}/admin/replay/start/${rm.endpointName}/${rm.name}`,
      );
      expect(startRes.ok()).toBeTruthy();

      const startBody = await startRes.json();
      expect(startBody.status).toBe('started');

      // Poll read model status — replay should complete quickly
      let replayDone = false;
      for (let i = 0; i < 30; i++) {
        const statusRes = await request.get(
          `${adminURL}/admin/readmodel/status/${rm.endpointName}/${rm.name}`,
        );
        const status = await statusRes.json();

        if (status.state === 'replay-done' || status.state === 'live') {
          replayDone = true;
          break;
        }

        await page.waitForTimeout(300);
      }
      expect(replayDone).toBeTruthy();

      await navigate(page, 'Customers');
      await expect(page.getByText(customerName)).toBeVisible();
    } finally {
      await ensureLive(request, rm);
      await page.close();
    }
  });

  test('replay status returns info for unknown model', async ({
    request,
    baseURL,
  }) => {
    const adminURL = getAdminURL(baseURL);
    await waitForAdmin(request, adminURL);

    const res = await request.get(
      `${adminURL}/admin/readmodel/status/_unknown/nonExistentModel`,
    );
    // New API returns 404 for unknown models
    expect(res.status()).toBe(404);
  });

  test('cancelReplay cancels an in-progress replay', async ({
    browser,
    request,
    baseURL,
  }) => {
    const adminURL = getAdminURL(baseURL);
    const rmConfig = getReadModelConfig(baseURL);
    const rm = rmConfig.customersOverview;
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
        `${adminURL}/admin/replay/start/${rm.endpointName}/${rm.name}`,
      );
      expect(startRes.ok()).toBeTruthy();

      const cancelRes = await request.post(
        `${adminURL}/admin/replay/cancel/${rm.endpointName}/${rm.name}`,
      );
      expect(cancelRes.ok()).toBeTruthy();

      // Wait for state to settle
      let finalState;
      for (let i = 0; i < 30; i++) {
        const statusRes = await request.get(
          `${adminURL}/admin/readmodel/status/${rm.endpointName}/${rm.name}`,
        );
        const status = await statusRes.json();

        if (
          status.state === 'idle' ||
          status.state === 'live'
        ) {
          finalState = status.state;
          break;
        }

        await page.waitForTimeout(300);
      }
      expect(['idle', 'live']).toContain(finalState);
    } finally {
      await ensureLive(request, rm);
      await page.close();
    }
  });
});
