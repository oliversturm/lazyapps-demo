import { test, expect } from '@playwright/test';
import { getAdminURL, waitForAdmin, waitForAdminUI } from './helpers/admin.js';

test.describe('Admin status and read models', () => {
  test('status endpoint returns read model info', async ({
    request,
    baseURL,
  }) => {
    const adminURL = getAdminURL(baseURL);
    await waitForAdmin(request, adminURL);

    const response = await request.get(`${adminURL}/admin/readmodel/status`);
    expect(response.ok()).toBeTruthy();

    const readModels = await response.json();
    expect(Array.isArray(readModels)).toBeTruthy();
    expect(readModels.length).toBeGreaterThan(0);

    for (const rm of readModels) {
      expect(rm).toHaveProperty('readModelName');
      expect(rm).toHaveProperty('endpointName');
      expect(rm).toHaveProperty('state');
    }
  });

  test('readmodel status endpoint lists all read models', async ({
    request,
    baseURL,
  }) => {
    const adminURL = getAdminURL(baseURL);
    await waitForAdmin(request, adminURL);

    const response = await request.get(`${adminURL}/admin/readmodel/status`);
    expect(response.ok()).toBeTruthy();

    const readModels = await response.json();
    expect(readModels.length).toBeGreaterThan(0);

    const names = readModels.map((rm) => `${rm.endpointName}/${rm.readModelName}`);
    expect(names.some((n) => n.includes('customersOverview') || n.includes('overview'))).toBeTruthy();
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
