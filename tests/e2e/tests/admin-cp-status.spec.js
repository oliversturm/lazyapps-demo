import { test, expect } from '@playwright/test';
import { getAdminURL, waitForAdmin, waitForAdminUI } from './helpers/admin.js';

// Issue #15: the Command Processor is always running, so its resting state is
// shown as 'live' (not the misleading 'idle'), and the dashboard CP card shows
// live-detail (uptime, counters, last command/event) proving health.
test.describe('Admin dashboard — Command Processor card', () => {
  test('shows the CP as live with live-detail fields', async ({
    page,
    request,
    baseURL,
  }) => {
    // CP status now reaches the admin in BOTH topologies: over HTTP SSE in
    // orchestrated (express command receiver), and bridged through the
    // SvelteKit /api backend from the in-process mqemitter in the monolith
    // (issue #23). So this runs unskipped in admin-monolith and
    // admin-orchestrated alike.
    const adminURL = getAdminURL(baseURL);
    await waitForAdmin(request, adminURL);
    await waitForAdminUI(page, adminURL);

    // Scope to the Command Processor card so RM badges don't interfere.
    const cpCard = page
      .locator('div.bg-white')
      .filter({
        has: page.getByRole('heading', { name: 'Command Processor' }),
      });
    await expect(cpCard).toBeVisible();

    // A: the CP resting badge is 'live', never the old 'idle'.
    await expect(cpCard.getByText('live', { exact: true })).toBeVisible();
    await expect(cpCard.getByText('idle', { exact: true })).toHaveCount(0);

    // B: live-detail fields render.
    await expect(cpCard.getByText('Uptime')).toBeVisible();
    await expect(cpCard.getByText('Commands processed')).toBeVisible();
    await expect(cpCard.getByText('Events written')).toBeVisible();
    await expect(cpCard.getByText('Last command')).toBeVisible();
    await expect(cpCard.getByText('Last event')).toBeVisible();

    // The counters carry through end-to-end as numbers (never the '—' dash).
    const commandsValue = cpCard
      .locator('dl div')
      .filter({ has: page.getByText('Commands processed', { exact: true }) })
      .locator('dd');
    await expect(commandsValue).toHaveText(/^\d+$/);
  });
});
