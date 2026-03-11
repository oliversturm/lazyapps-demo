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
 * has an activator that orchestrates: publish __admin instruction → RM
 * activates lifecycle → admin starts CP catchup → events stream → RM
 * goes live. Read model state queries go to the RM service (serviceUrl).
 *
 * In monolith mode, cpUrl and serviceUrl point to the same host (port 3005).
 * In orchestrated mode, cpUrl is the command-processor/admin service and
 * serviceUrl is the per-service RM endpoint.
 */

const pollForState = (request, serviceUrl, readModel, targetState, maxPolls = 30) => {
  const poll = async (i) => {
    if (i >= maxPolls) return null;
    const res = await request.get(`${serviceUrl}/admin/readmodels`);
    const models = await res.json();
    const model = models.find((r) => r.name === readModel);
    if (model.state === targetState) return model.state;
    await new Promise((resolve) => setTimeout(resolve, 500));
    return poll(i + 1);
  };
  return poll(0);
};

const ensureLive = async (request, cpUrl, serviceUrl, readModel) => {
  const rmRes = await request.get(`${serviceUrl}/admin/readmodels`);
  const readModels = await rmRes.json();
  const rm = readModels.find((r) => r.name === readModel);

  if (rm.state === 'live') return;

  await request.post(`${cpUrl}/admin/readmodels/${readModel}/activate`);
  const finalState = await pollForState(request, serviceUrl, readModel, 'live');
  expect(finalState).toBe('live');
};

test.describe('Admin catch-up lifecycle', () => {
  test('readmodels endpoint includes lifecycle state', async ({
    request,
    baseURL,
  }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const serviceUrl = rmConfig.customersOverview.serviceUrl;
    await waitForAdmin(request, getAdminURL(baseURL));

    const res = await request.get(`${serviceUrl}/admin/readmodels`);
    expect(res.ok()).toBeTruthy();

    const readModels = await res.json();
    expect(readModels.length).toBeGreaterThan(0);

    for (const rm of readModels) {
      expect(rm).toHaveProperty('name');
      expect(rm).toHaveProperty('status');
      expect(rm).toHaveProperty('collections');
      // Lifecycle is always active — every RM must have a state field
      expect(rm).toHaveProperty('state');
      expect([
        'waiting',
        'activating',
        'catching-up',
        'live',
        'stopped',
      ]).toContain(rm.state);
    }
  });

  test('activate read model triggers catch-up', async ({
    request,
    baseURL,
  }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const cpUrl = rmConfig.customersOverview.cpUrl;
    const serviceUrl = rmConfig.customersOverview.serviceUrl;
    const readModel = rmConfig.customersOverview.name;
    await waitForAdmin(request, getAdminURL(baseURL));

    // Check current state
    const rmRes = await request.get(`${serviceUrl}/admin/readmodels`);
    const readModels = await rmRes.json();
    const rm = readModels.find((r) => r.name === readModel);

    // If already live, stop it first to test activation
    if (rm.state === 'live') {
      const stopRes = await request.post(
        `${cpUrl}/admin/readmodels/${readModel}/stop`,
      );
      expect(stopRes.ok()).toBeTruthy();
      await pollForState(request, serviceUrl, readModel, 'stopped');
    }

    // Activate via admin server (triggers activator orchestration)
    const activateRes = await request.post(
      `${cpUrl}/admin/readmodels/${readModel}/activate`,
    );
    expect(activateRes.status()).toBe(202);
    const body = await activateRes.json();
    expect(body.status).toBe('activating');

    // Poll until the read model reaches 'live' state
    const finalState = await pollForState(
      request,
      serviceUrl,
      readModel,
      'live',
    );
    expect(finalState).toBe('live');
  });

  test('activate-all activates waiting read models', async ({
    request,
    baseURL,
  }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const cpUrl = rmConfig.customersOverview.cpUrl;
    await waitForAdmin(request, getAdminURL(baseURL));

    const activateRes = await request.post(
      `${cpUrl}/admin/readmodels/activate-all`,
    );

    expect(activateRes.status()).toBe(202);
    const body = await activateRes.json();
    expect(body.status).toBe('activating');
    expect(Array.isArray(body.readModels)).toBeTruthy();
  });

  test('stop read model changes state to stopped', async ({
    request,
    baseURL,
  }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const cpUrl = rmConfig.customersOverview.cpUrl;
    const serviceUrl = rmConfig.customersOverview.serviceUrl;
    const readModel = rmConfig.customersOverview.name;
    await waitForAdmin(request, getAdminURL(baseURL));

    // Ensure the read model is live first
    await ensureLive(request, cpUrl, serviceUrl, readModel);

    // Stop via admin server (publishes __admin stop instruction)
    const stopRes = await request.post(
      `${cpUrl}/admin/readmodels/${readModel}/stop`,
    );
    expect(stopRes.ok()).toBeTruthy();
    const stopBody = await stopRes.json();
    expect(stopBody.status).toBe('stopped');

    // Verify state changed on the RM side
    const afterState = await pollForState(
      request,
      serviceUrl,
      readModel,
      'stopped',
    );
    expect(afterState).toBe('stopped');

    // Re-activate so other tests aren't affected
    await request.post(
      `${cpUrl}/admin/readmodels/${readModel}/activate`,
    );
    await pollForState(request, serviceUrl, readModel, 'live');
  });

  test('catch-up status endpoint', async ({ request, baseURL }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const cpUrl = rmConfig.customersOverview.cpUrl;
    const readModel = rmConfig.customersOverview.name;
    await waitForAdmin(request, getAdminURL(baseURL));

    // Catchup status is served by the admin/CP server
    const statusRes = await request.get(
      `${cpUrl}/admin/catchup/${readModel}/status`,
    );
    expect(statusRes.ok()).toBeTruthy();

    const status = await statusRes.json();
    expect(status).toHaveProperty('status');
  });

  test('catch-up fills event gap after stop and restart', async ({
    browser,
    request,
    baseURL,
  }) => {
    test.setTimeout(60000);

    const rmConfig = getReadModelConfig(baseURL);
    const cpUrl = rmConfig.customersOverview.cpUrl;
    const serviceUrl = rmConfig.customersOverview.serviceUrl;
    const readModel = rmConfig.customersOverview.name;
    const unique = `${Date.now()}`;
    await waitForAdmin(request, getAdminURL(baseURL));

    const page = await browser.newPage();

    try {
      await waitForApp(page, baseURL);

      // Ensure read model is live via admin-driven activation
      await ensureLive(request, cpUrl, serviceUrl, readModel);

      // Create a customer while read model is live
      const customerBefore = `CatchupBefore-${unique}`;
      await createCustomer(page, {
        name: customerBefore,
        location: 'BeforeCity',
      });
      await navigate(page, 'Customers');
      await expect(page.getByText(customerBefore)).toBeVisible();

      // Stop the read model via admin server
      const stopRes = await request.post(
        `${cpUrl}/admin/readmodels/${readModel}/stop`,
      );
      expect(stopRes.ok()).toBeTruthy();
      await pollForState(request, serviceUrl, readModel, 'stopped');

      // Create a customer while read model is stopped — this creates an
      // event gap that catch-up must fill
      const customerDuring = `CatchupDuring-${unique}`;
      await createCustomer(page, {
        name: customerDuring,
        location: 'DuringCity',
      });

      // The stopped read model won't process events, so customerDuring
      // should not be visible yet (reload to confirm)
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('.bg-orange-100').waitFor();
      await navigate(page, 'Customers');

      // Re-activate via admin server — triggers activator orchestration
      // which does: __admin activate → RM lifecycle → CP catchup → events
      const activateRes = await request.post(
        `${cpUrl}/admin/readmodels/${readModel}/activate`,
      );
      expect(activateRes.status()).toBe(202);

      // Wait for catch-up to complete and reach 'live' state
      for (let i = 0; i < 60; i++) {
        const statusRes = await request.get(`${serviceUrl}/admin/readmodels`);
        const models = await statusRes.json();
        const model = models.find((r) => r.name === readModel);
        if (model.state === 'live') break;
        await page.waitForTimeout(500);
      }

      // Now the gap should be filled — customerDuring should appear
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        try {
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.locator('.bg-orange-100').waitFor();
          await navigate(page, 'Customers');
          await page.getByText(customerDuring).waitFor({ timeout: 2000 });
          break;
        } catch {
          // Keep polling
        }
      }
      await expect(page.getByText(customerBefore)).toBeVisible();
      await expect(page.getByText(customerDuring)).toBeVisible();
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
    const serviceUrl = rmConfig.customersOverview.serviceUrl;
    const readModel = rmConfig.customersOverview.name;
    await waitForAdmin(request, getAdminURL(baseURL));

    // Ensure it's live
    await ensureLive(request, cpUrl, serviceUrl, readModel);

    // With the activator, re-activating a live RM returns 202. The
    // activator orchestrates the request and handles the state internally
    // (the RM lifecycle manager will reject the duplicate activation).
    const activateRes = await request.post(
      `${cpUrl}/admin/readmodels/${readModel}/activate`,
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
      `${cpUrl}/admin/readmodels/nonExistentModel/activate`,
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
      `${cpUrl}/admin/readmodels/nonExistentModel/stop`,
    );
    expect(res.status()).toBe(404);
  });
});
