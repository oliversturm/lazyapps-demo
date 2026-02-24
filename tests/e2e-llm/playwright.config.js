import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120000,
  expect: {
    timeout: 30000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 2,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    actionTimeout: 10000,
  },
  projects: [
    {
      name: 'llm-demo',
      use: {
        baseURL: 'http://frontend:5173',
      },
    },
  ],
  globalTimeout: 600000,
});
