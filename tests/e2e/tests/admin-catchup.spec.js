import { test, expect } from '@playwright/test';
import { waitForApp, navigate, createCustomer } from './helpers/app.js';
import {
  getAdminURL,
  waitForAdmin,
  getReadModelConfig,
} from './helpers/admin.js';

/**
 * Catch-up E2E tests — admin-driven orchestration flow.
 *
 * Activation and stop commands go through the admin server (cpUrl) which
 * orchestrates: publish __admin instruction → RM activates lifecycle →
 * admin starts CP catchup → events stream → RM goes live. Read model state
 * queries go through the admin readmodel status endpoint.
 *
 * In monolith mode, cpUrl and adminUrl point to the same host (port 3005).
 * In orchestrated mode, cpUrl is the admin-ui service.
 */

const pollForState = async (request, adminUrl, endpointName, readModel, targetState, maxPolls = 30) => {
  for (let i = 0; i < maxPolls; i++) {
    const res = await request.get(
      `${adminUrl}/admin/readmodel/status/${endpointName}/${readModel}`,
    );
    const status = await res.json();
    if (status && status.state === targetState) return status.state;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
};

const ensureLive = async (request, cpUrl, adminUrl, endpointName, readModel) => {
  const res = await request.get(
    `${adminUrl}/admin/readmodel/status/${endpointName}/${readModel}`,
  );
  const status = await res.json();

  if (status && status.state === 'live') return;

  await request.post(
    `${cpUrl}/admin/readmodel/activate/${endpointName}/${readModel}`,
  );
  const finalState = await pollForState(request, adminUrl, endpointName, readModel, 'live');
  expect(finalState).toBe('live');
};

test.describe('Admin catch-up lifecycle', () => {
  test('readmodel status includes lifecycle state', async ({
    request,
    baseURL,
  }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const adminUrl = rmConfig.customersOverview.adminUrl;
    await waitForAdmin(request, getAdminURL(baseURL));

    const res = await request.get(
      `${adminUrl}/admin/readmodel/status/${rmConfig.customersOverview.endpointName}/${rmConfig.customersOverview.name}`,
    );
    expect(res.ok()).toBeTruthy();

    const status = await res.json();
    expect(status).toHaveProperty('state');
    expect([
      'idle',
      'activating',
      'catchup',
      'live',
    ]).toContain(status.state);
  });

  test('activate read model triggers catch-up', async ({
    request,
    baseURL,
  }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const cpUrl = rmConfig.customersOverview.cpUrl;
    const adminUrl = rmConfig.customersOverview.adminUrl;
    const readModel = rmConfig.customersOverview.name;
    const endpointName = rmConfig.customersOverview.endpointName;
    await waitForAdmin(request, getAdminURL(baseURL));

    // Check current state
    const statusRes = await request.get(
      `${adminUrl}/admin/readmodel/status/${endpointName}/${readModel}`,
    );
    const status = await statusRes.json();

    // If already live, stop it first to test activation
    if (status.state === 'live') {
      const stopRes = await request.post(
        `${cpUrl}/admin/readmodel/stop/${endpointName}/${readModel}`,
      );
      expect(stopRes.ok()).toBeTruthy();
      await pollForState(request, adminUrl, endpointName, readModel, 'idle');
    }

    // Activate via admin server (triggers activator orchestration)
    const activateRes = await request.post(
      `${cpUrl}/admin/readmodel/activate/${endpointName}/${readModel}`,
    );
    expect(activateRes.status()).toBe(202);
    const body = await activateRes.json();
    expect(body.status).toBe('activating');

    // Poll until the read model reaches 'live' state
    const finalState = await pollForState(
      request,
      adminUrl,
      endpointName,
      readModel,
      'live',
    );
    expect(finalState).toBe('live');
  });

  test('activate-all activates read models', async ({
    request,
    baseURL,
  }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const cpUrl = rmConfig.customersOverview.cpUrl;
    await waitForAdmin(request, getAdminURL(baseURL));

    const activateRes = await request.post(
      `${cpUrl}/admin/readmodel/activate-all`,
    );

    expect(activateRes.status()).toBe(202);
    const body = await activateRes.json();
    expect(body.status).toBe('activating');
    expect(Array.isArray(body.readModels)).toBeTruthy();
  });

  test('stop read model changes state to idle', async ({
    request,
    baseURL,
  }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const cpUrl = rmConfig.customersOverview.cpUrl;
    const adminUrl = rmConfig.customersOverview.adminUrl;
    const readModel = rmConfig.customersOverview.name;
    const endpointName = rmConfig.customersOverview.endpointName;
    await waitForAdmin(request, getAdminURL(baseURL));

    // Ensure the read model is live first
    await ensureLive(request, cpUrl, adminUrl, endpointName, readModel);

    // Stop via admin server
    const stopRes = await request.post(
      `${cpUrl}/admin/readmodel/stop/${endpointName}/${readModel}`,
    );
    expect(stopRes.ok()).toBeTruthy();
    const stopBody = await stopRes.json();
    expect(stopBody.status).toBe('stopping');

    // Verify state changed
    const afterState = await pollForState(
      request,
      adminUrl,
      endpointName,
      readModel,
      'idle',
    );
    expect(afterState).toBe('idle');

    // Re-activate so other tests aren't affected
    await request.post(
      `${cpUrl}/admin/readmodel/activate/${endpointName}/${readModel}`,
    );
    await pollForState(request, adminUrl, endpointName, readModel, 'live');
  });

  test('catch-up fills event gap after stop and restart', async ({
    browser,
    request,
    baseURL,
  }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const cpUrl = rmConfig.customersOverview.cpUrl;
    const adminUrl = rmConfig.customersOverview.adminUrl;
    const readModel = rmConfig.customersOverview.name;
    const endpointName = rmConfig.customersOverview.endpointName;
    const unique = `${Date.now()}`;
    await waitForAdmin(request, getAdminURL(baseURL));

    const page = await browser.newPage();

    try {
      await waitForApp(page, baseURL);

      // Ensure read model is live via admin-driven activation
      await ensureLive(request, cpUrl, adminUrl, endpointName, readModel);

      // Create a customer while read model is live
      const customerBefore = `CatchupBefore-${unique}`;
      await createCustomer(page, {
        name: customerBefore,
        location: 'BeforeCity',
      });
      await navigate(page, 'Customers');
      await expect(page.getByText(customerBefore).first()).toBeVisible();

      // Stop the read model via admin server
      const stopRes = await request.post(
        `${cpUrl}/admin/readmodel/stop/${endpointName}/${readModel}`,
      );
      expect(stopRes.ok()).toBeTruthy();
      await pollForState(request, adminUrl, endpointName, readModel, 'idle');

      // Create a customer while read model is idle — this creates an
      // event gap that catch-up must fill
      const customerDuring = `CatchupDuring-${unique}`;
      await createCustomer(page, {
        name: customerDuring,
        location: 'DuringCity',
      });

      // The idle read model won't process events, so customerDuring
      // should not be visible yet (reload to confirm)
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('.bg-orange-100').waitFor();
      await navigate(page, 'Customers');

      // Re-activate via admin server — triggers activator orchestration
      const activateRes = await request.post(
        `${cpUrl}/admin/readmodel/activate/${endpointName}/${readModel}`,
      );
      expect(activateRes.status()).toBe(202);

      // Wait for catch-up to complete and reach 'live' state
      await pollForState(request, adminUrl, endpointName, readModel, 'live', 60);

      // Now the gap should be filled — customerDuring should appear
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        try {
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.locator('.bg-orange-100').waitFor();
          await navigate(page, 'Customers');
          await page.getByText(customerDuring).waitFor();
          break;
        } catch {
          // Keep polling
        }
      }
      await expect(page.getByText(customerBefore).first()).toBeVisible();
      await expect(page.getByText(customerDuring).first()).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test('activate already-live read model returns 202', async ({
    request,
    baseURL,
  }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const cpUrl = rmConfig.customersOverview.cpUrl;
    const adminUrl = rmConfig.customersOverview.adminUrl;
    const readModel = rmConfig.customersOverview.name;
    const endpointName = rmConfig.customersOverview.endpointName;
    await waitForAdmin(request, getAdminURL(baseURL));

    // Ensure it's live
    await ensureLive(request, cpUrl, adminUrl, endpointName, readModel);

    const activateRes = await request.post(
      `${cpUrl}/admin/readmodel/activate/${endpointName}/${readModel}`,
    );
    expect(activateRes.status()).toBe(202);
    const body = await activateRes.json();
    expect(body.status).toBe('activating');
  });

  test('activate returns 404 for unknown read model', async ({
    request,
    baseURL,
  }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const cpUrl = rmConfig.customersOverview.cpUrl;
    await waitForAdmin(request, getAdminURL(baseURL));

    const res = await request.post(
      `${cpUrl}/admin/readmodel/activate/_unknown/nonExistentModel`,
    );
    expect(res.status()).toBe(404);
  });

  test('stop returns 404 for unknown read model', async ({
    request,
    baseURL,
  }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const cpUrl = rmConfig.customersOverview.cpUrl;
    await waitForAdmin(request, getAdminURL(baseURL));

    const res = await request.post(
      `${cpUrl}/admin/readmodel/stop/_unknown/nonExistentModel`,
    );
    expect(res.status()).toBe(404);
  });
});
