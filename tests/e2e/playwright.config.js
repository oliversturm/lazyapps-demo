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
  globalSetup: './global-setup.js',
  use: {
    ...devices['Desktop Chrome'],
    actionTimeout: 5000,
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

    // --- Orchestrated Svelte: all tests except forget-subject ---
    {
      name: 'orchestrated-svelte',
      dependencies: ['setup'],
      testIgnore: [/forget-subject/],
      use: {
        baseURL: 'http://svelte.localhost',
      },
    },

    // --- Orchestrated Svelte forget-subject: runs AFTER main svelte tests
    // because forget tests shred encryption keys for bob/carol/dave, making
    // those user accounts unusable for subsequent customer creation ---
    {
      name: 'orchestrated-svelte-forget',
      dependencies: ['orchestrated-svelte'],
      testMatch: /forget-subject\.spec\.js/,
      use: {
        baseURL: 'http://svelte.localhost',
      },
    },

    // --- Orchestrated React: runs after setup, excludes forget-subject ---
    {
      name: 'orchestrated-react',
      dependencies: ['setup'],
      testIgnore: [/forget-subject/],
      use: {
        baseURL: 'http://react.localhost',
      },
    },

    // --- Orchestrated React forget-subject: runs AFTER main react tests
    // using eve/frank/grace (separate from svelte's bob/carol/dave) ---
    {
      name: 'orchestrated-react-forget',
      dependencies: ['orchestrated-react'],
      testMatch: /forget-subject\.spec\.js/,
      use: {
        baseURL: 'http://react.localhost',
      },
    },
  ],
});
