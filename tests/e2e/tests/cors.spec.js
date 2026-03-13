import { test, expect } from '@playwright/test';
import { waitForApp } from './helpers/app.js';

// CORS tests only run on orchestrated projects where the browser
// loads from svelte.localhost/react.localhost and makes API calls
// to commands.localhost, rm-customers.localhost, etc.
// These are genuine cross-origin requests enforced by the browser.

test.describe('CORS through Traefik', () => {
  test('browser can fetch from read model (cross-origin)', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await waitForApp(page, baseURL);

      // From the frontend origin (e.g., svelte.localhost), make a
      // cross-origin fetch to the read model API.
      // This triggers a CORS preflight (OPTIONS) and the actual GET.
      const result = await page.evaluate(async () => {
        try {
          const res = await fetch(
            'http://rm-customers.localhost/query/overview/all',
          );
          return { ok: res.ok, status: res.status, cors: true };
        } catch (e) {
          return { ok: false, status: 0, error: e.message, cors: false };
        }
      });

      expect(
        result.cors,
        'Cross-origin fetch should not be blocked by CORS',
      ).toBeTruthy();
      // Any non-zero status means CORS allowed the request through.
      // 401 is acceptable — it means auth is required but CORS didn't block.
      expect(result.status).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });

  test('browser can POST command (cross-origin)', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await waitForApp(page, baseURL);

      // Cross-origin POST with JSON content-type triggers CORS preflight
      const result = await page.evaluate(async () => {
        try {
          const res = await fetch('http://commands.localhost/api/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'CORS_TEST',
              aggregateId: 'cors-test-id',
              payload: {},
            }),
          });
          // The command will fail (unknown command type) but the request
          // should reach the server — CORS should not block it.
          return { status: res.status, cors: true };
        } catch (e) {
          return { status: 0, error: e.message, cors: false };
        }
      });

      expect(
        result.cors,
        'Cross-origin POST should not be blocked by CORS',
      ).toBeTruthy();
      // 400, 401, or 500 from unknown command type is fine —
      // we care that CORS didn't block it
      expect(result.status).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });

  test('Socket.io change-notifier allows cross-origin connection', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await waitForApp(page, baseURL);

      // Verify the change-notifier endpoint is reachable cross-origin.
      // Socket.io uses an HTTP handshake before upgrading to WebSocket.
      const result = await page.evaluate(async () => {
        try {
          const res = await fetch(
            'http://change-notifier.localhost/socket.io/?EIO=4&transport=polling',
          );
          return { ok: res.ok, status: res.status, cors: true };
        } catch (e) {
          return { ok: false, error: e.message, cors: false };
        }
      });

      expect(
        result.cors,
        'Socket.io polling endpoint should allow cross-origin',
      ).toBeTruthy();
      // Any non-zero status means CORS allowed the request through
      expect(result.status).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
});
