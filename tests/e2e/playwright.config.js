import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 10000,
  expect: {
    timeout: 1000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    actionTimeout: 1000,
    launchOptions: {
      args: [
        // Chromium resolves .localhost to 127.0.0.1 per RFC 6761, bypassing
        // /etc/hosts. Override to route through Traefik's dynamic container IP.
        // TRAEFIK_IP is resolved by run-orchestrated.sh at runtime.
        `--host-resolver-rules=MAP *.localhost ${process.env.TRAEFIK_IP || '127.0.0.1'}`,
      ],
    },
  },
  projects: [
    // --- Monolith Svelte: basic CQRS tests without auth/encryption ---
    {
      name: 'monolith-svelte',
      testIgnore: [
        /forget-subject/,
        /encryption/,
        /vault-auth/,
        /cors/,
        /keycloak-auth/,
        /health/,
      ],
      use: {
        baseURL: 'http://monolith:5173',
        launchOptions: {
          // No host-resolver-rules needed — monolith uses Docker DNS
          args: [],
        },
      },
    },

    // --- Orchestrated Svelte ---
    {
      name: 'orchestrated-svelte',
      use: {
        baseURL: 'http://svelte.localhost',
      },
    },

    // --- Orchestrated Svelte forget ---
    {
      name: 'orchestrated-svelte-forget',
      testMatch: /forget-subject\.spec\.js/,
      use: {
        baseURL: 'http://svelte.localhost',
      },
    },

    // --- Orchestrated React ---
    {
      name: 'orchestrated-react',
      use: {
        baseURL: 'http://react.localhost',
      },
    },

    // --- Orchestrated React forget ---
    {
      name: 'orchestrated-react-forget',
      testMatch: /forget-subject\.spec\.js/,
      use: {
        baseURL: 'http://react.localhost',
      },
    },
  ],
});
