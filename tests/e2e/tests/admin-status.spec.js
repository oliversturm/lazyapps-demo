import { test, expect } from '@playwright/test';
import { getAdminURL, waitForAdmin, waitForAdminUI } from './helpers/admin.js';

test.describe('Admin status and read models', () => {
  test('status endpoint returns service info', async ({
    request,
    baseURL,
  }) => {
    const adminURL = getAdminURL(baseURL);
    await waitForAdmin(request, adminURL);

    const response = await request.get(`${adminURL}/admin/status`);
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body).toHaveProperty('service');
    expect(body).toHaveProperty('uptime');
    expect(body.readModels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: expect.any(String) }),
      ]),
    );
  });

  test('readmodels endpoint lists all read models', async ({
    request,
    baseURL,
  }) => {
    const adminURL = getAdminURL(baseURL);
    await waitForAdmin(request, adminURL);

    const response = await request.get(`${adminURL}/admin/readmodels`);
    expect(response.ok()).toBeTruthy();

    const readModels = await response.json();
    expect(readModels.length).toBeGreaterThan(0);

    const names = readModels.map((rm) => rm.name);
    expect(names).toContain('customersOverview');
    expect(names).toContain('ordersOverview');

    for (const rm of readModels) {
      expect(rm).toHaveProperty('name');
      expect(rm).toHaveProperty('status');
      expect(rm).toHaveProperty('endpointName');
    }
  });

  test('admin UI dashboard loads', async ({ browser, baseURL }) => {
    const adminURL = getAdminURL(baseURL);
    const page = await browser.newPage();

    try {
      await waitForAdminUI(page, adminURL);

      await expect(
        page.getByRole('heading', { name: 'Dashboard' }),
      ).toBeVisible();

      // Nav links present
      await expect(
        page.getByRole('link', { name: 'Read Models' }),
      ).toBeVisible();
    } finally {
      await page.close();
    }
  });

  test('admin UI read models page loads', async ({ browser, baseURL }) => {
    const adminURL = getAdminURL(baseURL);
    const page = await browser.newPage();

    try {
      await waitForAdminUI(page, adminURL);

      // Navigate to Read Models page
      await page.getByRole('link', { name: 'Read Models' }).click();

      await expect(
        page.getByRole('heading', { name: 'Read Models' }),
      ).toBeVisible();
    } finally {
      await page.close();
    }
  });
});
