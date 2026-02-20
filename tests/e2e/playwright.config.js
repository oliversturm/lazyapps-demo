import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
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
  },
  projects: [
    {
      name: 'monolith-svelte',
      use: {
        baseURL: 'http://monolith:5173',
      },
    },
    {
      name: 'orchestrated-svelte',
      use: {
        baseURL: 'http://frontend-svelte:5173',
      },
    },
    {
      name: 'orchestrated-react',
      use: {
        baseURL: 'http://frontend-react:5173',
      },
    },
  ],
});
