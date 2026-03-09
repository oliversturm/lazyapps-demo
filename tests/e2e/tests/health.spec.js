import { test, expect } from '@playwright/test';

const ORCHESTRATED_SERVICES = [
  { name: 'command-processor', url: 'http://commands.localhost/api/command' },
  {
    name: 'readmodel-customers',
    url: 'http://rm-customers.localhost/query/overview/all',
  },
  {
    name: 'readmodel-orders',
    url: 'http://rm-orders.localhost/query/overview/all',
  },
  { name: 'change-notifier', url: 'http://change-notifier.localhost' },
];

// This test file runs as the 'setup' project — all other projects depend on it.
// It verifies that Traefik is routing correctly and all backend services are alive.

test.describe('Service health checks', () => {
  for (const { name, url } of ORCHESTRATED_SERVICES) {
    test(`${name} responds through Traefik`, async ({ request }) => {
      let lastError;
      for (let i = 0; i < 30; i++) {
        try {
          const response = await request.get(url, { timeout: 3000 });
          // Any HTTP response (even 404) means the service is alive and
          // Traefik is routing. A Traefik 502/503 means the backend is down.
          expect(response.status()).toBeLessThan(500);
          return;
        } catch (e) {
          lastError = e;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      throw new Error(
        `${name} not reachable through Traefik after 60s: ${lastError?.message}`,
      );
    });
  }

  test('monolith responds directly', async ({ request }) => {
    let lastError;
    for (let i = 0; i < 30; i++) {
      try {
        const response = await request.get('http://monolith:5173', {
          timeout: 3000,
        });
        expect(response.status()).toBeLessThan(500);
        return;
      } catch (e) {
        lastError = e;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    throw new Error(
      `monolith not reachable after 60s: ${lastError?.message}`,
    );
  });
});
