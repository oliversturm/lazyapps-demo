import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  expect: {
    timeout: 2000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    actionTimeout: 3000,
    launchOptions: {
      args: [
        // Chromium resolves .localhost to 127.0.0.1 per RFC 6761, bypassing
        // /etc/hosts. Override to route through Traefik's static IP instead.
        '--host-resolver-rules=MAP *.localhost 172.28.0.100',
      ],
    },
  },
  projects: [
    // --- Setup: health checks (runs first, no dependencies) ---
    {
      name: 'setup',
      testMatch: /health\.spec\.js/,
    },

    // --- Monolith: unchanged, depends on setup ---
    {
      name: 'monolith-svelte',
      dependencies: ['setup'],
      use: {
        baseURL: 'http://monolith:5173',
      },
      testIgnore: [/forget-subject/, /encryption/, /vault-auth/, /cors/],
    },

    // --- Orchestrated: now through Traefik ---
    {
      name: 'orchestrated-svelte',
      dependencies: ['setup'],
      use: {
        baseURL: 'http://svelte.localhost',
      },
    },
    {
      name: 'orchestrated-react',
      dependencies: ['setup'],
      use: {
        baseURL: 'http://react.localhost',
      },
    },
  ],
});
