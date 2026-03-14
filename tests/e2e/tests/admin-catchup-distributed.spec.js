import { test, expect } from '@playwright/test';
import { waitForApp, navigate, createCustomer } from './helpers/app.js';
import {
  getAdminURL,
  waitForAdmin,
  getReadModelConfig,
} from './helpers/admin.js';

/**
 * Distributed catch-up E2E tests — orchestrated deployment.
 *
 * These tests exercise the catch-up lifecycle in a distributed topology
 * where command-processor, read model services, and admin-ui are separate
 * containers. The admin-ui orchestrates activation/stop commands, and
 * catch-up flows through the event bus (RabbitMQ).
 *
 * cpUrl points to admin-ui (the orchestrator), while serviceUrl points
 * to the individual read model service for state queries.
 */

const pollForState = (
  request,
  serviceUrl,
  readModel,
  targetState,
  maxPolls = 30,
) => {
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

const ensureLive = async (
  request,
  cpUrl,
  serviceUrl,
  endpointName,
  readModel,
) => {
  const rmRes = await request.get(`${serviceUrl}/admin/readmodels`);
  const readModels = await rmRes.json();
  const rm = readModels.find((r) => r.name === readModel);

  if (rm.state === 'live') return;

  await request.post(
    `${cpUrl}/admin/readmodels/${endpointName}/${readModel}/activate`,
  );
  const finalState = await pollForState(
    request,
    serviceUrl,
    readModel,
    'live',
  );
  expect(finalState).toBe('live');
};

test.describe('Distributed catch-up lifecycle', () => {
  test('auto-activation brings read models to live state', async ({
    request,
    baseURL,
  }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const serviceUrl = rmConfig.customersOverview.serviceUrl;
    await waitForAdmin(request, getAdminURL(baseURL));

    // With autoActivate: true in admin-ui, read models should already
    // be live (or transitioning) after startup
    const finalState = await pollForState(
      request,
      serviceUrl,
      'overview',
      'live',
      60,
    );
    expect(finalState).toBe('live');
  });

  test('readmodels endpoint returns lifecycle state', async ({
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
      expect(rm).toHaveProperty('endpointName');
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

  test('activate and stop via admin-ui orchestrator', async ({
    request,
    baseURL,
  }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const cpUrl = rmConfig.customersOverview.cpUrl;
    const serviceUrl = rmConfig.customersOverview.serviceUrl;
    const readModel = rmConfig.customersOverview.name;
    const endpointName = rmConfig.customersOverview.endpointName;
    await waitForAdmin(request, getAdminURL(baseURL));

    // Ensure live first
    await ensureLive(request, cpUrl, serviceUrl, endpointName, readModel);

    // Stop via admin-ui orchestrator
    const stopRes = await request.post(
      `${cpUrl}/admin/readmodels/${endpointName}/${readModel}/stop`,
    );
    expect(stopRes.ok()).toBeTruthy();
    const stopBody = await stopRes.json();
    expect(stopBody.status).toBe('stopped');

    // Verify state changed on the RM side
    const stoppedState = await pollForState(
      request,
      serviceUrl,
      readModel,
      'stopped',
    );
    expect(stoppedState).toBe('stopped');

    // Re-activate via admin-ui orchestrator
    const activateRes = await request.post(
      `${cpUrl}/admin/readmodels/${endpointName}/${readModel}/activate`,
    );
    expect(activateRes.status()).toBe(202);
    const body = await activateRes.json();
    expect(body.status).toBe('activating');

    // Wait for live
    const liveState = await pollForState(
      request,
      serviceUrl,
      readModel,
      'live',
    );
    expect(liveState).toBe('live');
  });

  test('catch-up fills event gap after stop and restart', async ({
    browser,
    request,
    baseURL,
  }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const cpUrl = rmConfig.customersOverview.cpUrl;
    const serviceUrl = rmConfig.customersOverview.serviceUrl;
    const readModel = rmConfig.customersOverview.name;
    const endpointName = rmConfig.customersOverview.endpointName;
    const unique = `${Date.now()}`;
    await waitForAdmin(request, getAdminURL(baseURL));

    const page = await browser.newPage();

    try {
      await waitForApp(page, baseURL);

      // Ensure read model is live via admin-driven activation
      await ensureLive(request, cpUrl, serviceUrl, endpointName, readModel);

      // Create a customer while read model is live
      const customerBefore = `DistBefore-${unique}`;
      await createCustomer(page, {
        name: customerBefore,
        location: 'BeforeCity',
      });
      await navigate(page, 'Customers');
      await expect(page.getByText(customerBefore)).toBeVisible();

      // Stop the read model via admin-ui orchestrator
      const stopRes = await request.post(
        `${cpUrl}/admin/readmodels/${endpointName}/${readModel}/stop`,
      );
      expect(stopRes.ok()).toBeTruthy();
      await pollForState(request, serviceUrl, readModel, 'stopped');

      // Create a customer while read model is stopped — this creates an
      // event gap that catch-up must fill
      const customerDuring = `DistDuring-${unique}`;
      await createCustomer(page, {
        name: customerDuring,
        location: 'DuringCity',
      });

      // The stopped read model won't process events, so customerDuring
      // should not be visible yet (reload to confirm)
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('.bg-orange-100').waitFor();
      await navigate(page, 'Customers');

      // Re-activate via admin-ui orchestrator — triggers activator
      // orchestration: __admin activate → RM lifecycle → CP catchup →
      // events stream → RM goes live
      const activateRes = await request.post(
        `${cpUrl}/admin/readmodels/${endpointName}/${readModel}/activate`,
      );
      expect(activateRes.status()).toBe(202);

      // Wait for catch-up to complete and reach 'live' state
      for (let i = 0; i < 60; i++) {
        const statusRes = await request.get(
          `${serviceUrl}/admin/readmodels`,
        );
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
          await page.getByText(customerDuring).waitFor();
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

  test('no duplicate projections after catch-up', async ({
    browser,
    request,
    baseURL,
  }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const cpUrl = rmConfig.customersOverview.cpUrl;
    const serviceUrl = rmConfig.customersOverview.serviceUrl;
    const readModel = rmConfig.customersOverview.name;
    const endpointName = rmConfig.customersOverview.endpointName;
    const unique = `${Date.now()}`;
    await waitForAdmin(request, getAdminURL(baseURL));

    const page = await browser.newPage();

    try {
      await waitForApp(page, baseURL);

      // Ensure read model is live
      await ensureLive(request, cpUrl, serviceUrl, endpointName, readModel);

      // Create a customer with a unique name
      const customerName = `DistNoDup-${unique}`;
      await createCustomer(page, {
        name: customerName,
        location: 'NoDupCity',
      });
      await navigate(page, 'Customers');
      await expect(page.getByText(customerName)).toBeVisible();

      // Stop → activate cycle to trigger catch-up
      await request.post(
        `${cpUrl}/admin/readmodels/${endpointName}/${readModel}/stop`,
      );
      await pollForState(request, serviceUrl, readModel, 'stopped');

      await request.post(
        `${cpUrl}/admin/readmodels/${endpointName}/${readModel}/activate`,
      );
      const liveState = await pollForState(
        request,
        serviceUrl,
        readModel,
        'live',
        60,
      );
      expect(liveState).toBe('live');

      // Reload and verify the customer appears exactly once
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('.bg-orange-100').waitFor();
      await navigate(page, 'Customers');

      // Wait for customer to appear
      await page.getByText(customerName).waitFor();

      // Count occurrences — should be exactly 1
      const count = await page.getByText(customerName).count();
      expect(count).toBe(1);
    } finally {
      await page.close();
    }
  });
});
