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
 * cpUrl points to admin-ui (the orchestrator), while adminUrl also points
 * to admin-ui for status queries via the consolidated admin routes.
 */

const pollForState = async (
  request,
  adminUrl,
  endpointName,
  readModel,
  targetState,
  maxPolls = 30,
) => {
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

const ensureLive = async (
  request,
  cpUrl,
  adminUrl,
  endpointName,
  readModel,
) => {
  const res = await request.get(
    `${adminUrl}/admin/readmodel/status/${endpointName}/${readModel}`,
  );
  const status = await res.json();

  if (status && status.state === 'live') return;

  await request.post(
    `${cpUrl}/admin/readmodel/activate/${endpointName}/${readModel}`,
  );
  const finalState = await pollForState(
    request,
    adminUrl,
    endpointName,
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
    const adminUrl = rmConfig.customersOverview.adminUrl;
    await waitForAdmin(request, getAdminURL(baseURL));

    // With autoActivate: true in admin-ui, read models should already
    // be live (or transitioning) after startup
    const finalState = await pollForState(
      request,
      adminUrl,
      'customers',
      'overview',
      'live',
      60,
    );
    expect(finalState).toBe('live');
  });

  test('readmodel status returns lifecycle state', async ({
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
    expect(status).toHaveProperty('endpointName');
    expect(status).toHaveProperty('readModelName');
    expect(status).toHaveProperty('state');
    expect([
      'stopped',
      'activating',
      'catchup',
      'live',
    ]).toContain(status.state);
  });

  test('activate and stop via admin-ui orchestrator', async ({
    request,
    baseURL,
  }) => {
    const rmConfig = getReadModelConfig(baseURL);
    const cpUrl = rmConfig.customersOverview.cpUrl;
    const adminUrl = rmConfig.customersOverview.adminUrl;
    const readModel = rmConfig.customersOverview.name;
    const endpointName = rmConfig.customersOverview.endpointName;
    await waitForAdmin(request, getAdminURL(baseURL));

    // Ensure live first
    await ensureLive(request, cpUrl, adminUrl, endpointName, readModel);

    // Stop via admin-ui orchestrator
    const stopRes = await request.post(
      `${cpUrl}/admin/readmodel/stop/${endpointName}/${readModel}`,
    );
    expect(stopRes.ok()).toBeTruthy();
    const stopBody = await stopRes.json();
    expect(stopBody.status).toBe('stopping');

    // Verify state changed
    const stoppedState = await pollForState(
      request,
      adminUrl,
      endpointName,
      readModel,
      'stopped',
    );
    expect(stoppedState).toBe('stopped');

    // Re-activate via admin-ui orchestrator
    const activateRes = await request.post(
      `${cpUrl}/admin/readmodel/activate/${endpointName}/${readModel}`,
    );
    expect(activateRes.status()).toBe(202);
    const body = await activateRes.json();
    expect(body.status).toBe('activating');

    // Wait for live
    const liveState = await pollForState(
      request,
      adminUrl,
      endpointName,
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
      const customerBefore = `DistBefore-${unique}`;
      await createCustomer(page, {
        name: customerBefore,
        location: 'BeforeCity',
      });
      await navigate(page, 'Customers');
      await expect(page.getByText(customerBefore)).toBeVisible();

      // Stop the read model via admin-ui orchestrator
      const stopRes = await request.post(
        `${cpUrl}/admin/readmodel/stop/${endpointName}/${readModel}`,
      );
      expect(stopRes.ok()).toBeTruthy();
      await pollForState(request, adminUrl, endpointName, readModel, 'stopped');

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

      // Re-activate via admin-ui orchestrator
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

  test('no duplicate projections after catch-up', async ({
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

      // Ensure read model is live
      await ensureLive(request, cpUrl, adminUrl, endpointName, readModel);

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
        `${cpUrl}/admin/readmodel/stop/${endpointName}/${readModel}`,
      );
      await pollForState(request, adminUrl, endpointName, readModel, 'stopped');

      await request.post(
        `${cpUrl}/admin/readmodel/activate/${endpointName}/${readModel}`,
      );
      const liveState = await pollForState(
        request,
        adminUrl,
        endpointName,
        readModel,
        'live',
        60,
      );
      expect(liveState).toBe('live');

      // Reload and verify the customer appears exactly once
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('.bg-orange-100').waitFor();
      await navigate(page, 'Customers');

      // Wait for customer to appear, then verify exactly 1 row
      await page.getByText(customerName).first().waitFor();
      const rows = page.locator('tr', {
        has: page.getByText(customerName, { exact: true }),
      });
      await expect(rows).toHaveCount(1);
    } finally {
      await page.close();
    }
  });
});
