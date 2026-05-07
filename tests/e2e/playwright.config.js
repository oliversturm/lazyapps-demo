import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 10000,
  expect: {
    timeout: 2000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    actionTimeout: 2000,
  },
  projects: [
    // T=0 tests must run BEFORE app tests that create events
    {
      name: 'tzero-monolith',
      testMatch: '**/admin-tzero.spec.js',
      use: {
        baseURL: 'http://monolith:5173',
      },
    },
    {
      name: 'tzero-orchestrated',
      testMatch: '**/admin-tzero.spec.js',
      use: {
        baseURL: 'http://frontend-svelte:5173',
      },
    },
    {
      name: 'monolith-svelte',
      testIgnore: '**/admin-*.spec.js',
      use: {
        baseURL: 'http://monolith:5173',
      },
    },
    {
      name: 'orchestrated-svelte',
      testIgnore: '**/admin-*.spec.js',
      use: {
        baseURL: 'http://frontend-svelte:5173',
      },
    },
    {
      name: 'orchestrated-react',
      testIgnore: '**/admin-*.spec.js',
      use: {
        baseURL: 'http://frontend-react:5173',
      },
    },
    {
      name: 'admin-monolith',
      testMatch: '**/admin-*.spec.js',
      testIgnore: ['**/admin-*-distributed.spec.js', '**/admin-tzero.spec.js'],
      use: {
        baseURL: 'http://monolith:5173',
      },
    },
    {
      name: 'admin-orchestrated',
      testMatch: ['**/admin-*-ui.spec.js', '**/admin-backup-files.spec.js', '**/admin-devmode.spec.js'],
      use: {
        baseURL: 'http://frontend-svelte:5173',
      },
    },
    {
      name: 'admin-catchup-orchestrated',
      testMatch: '**/admin-catchup-distributed.spec.js',
      use: {
        baseURL: 'http://frontend-svelte:5173',
      },
    },
  ],
});
