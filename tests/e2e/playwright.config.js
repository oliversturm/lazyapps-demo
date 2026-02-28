import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 5000,
  expect: {
    timeout: 500,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    actionTimeout: 500,
  },
  projects: [
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
      use: {
        baseURL: 'http://monolith:5173',
      },
    },
  ],
});
