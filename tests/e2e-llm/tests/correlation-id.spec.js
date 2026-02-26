import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import {
  waitForApp,
  createCustomer,
  placeOrder,
  getCustomerIdByName,
  pollReputation,
} from './helpers/app.js';

const LOG_FILE = '/shared-logs/readmodel-orders.log';

// Strip ANSI escape codes (chalk may emit them even in non-TTY)
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

test.describe('Correlation ID propagation', () => {
  test('no CORR-NONE in readmodel-orders logs after order flow', async ({
    browser,
    baseURL,
  }) => {
    const unique = `${Date.now()}`;
    const customerName = `CorrTest-${unique}`;

    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await waitForApp(page, baseURL);

      // Create a customer and place an order — this triggers:
      //   1. reputationRoutingSideEffect (ORDER_CREATED)
      //   2. trendAnalysisSideEffect (ORDER_CREATED, but only if >= 3 orders)
      //   3. reputationReassessmentSideEffect (on CONFIRM/REQUIRE_CONFIRMATION)
      await createCustomer(page, { name: customerName, location: 'TestCity' });
      await placeOrder(page, customerName, {
        text: `CorrOrder-${unique}`,
        value: 500,
      });

      // Wait for reputation routing + reassessment side effects to complete.
      // The order triggers reputation routing which confirms/requires confirmation,
      // and that in turn triggers a reputation reassessment with an LLM call.
      const customerId = await getCustomerIdByName(page, customerName);
      const reps = await pollReputation(page, customerId, {
        minCount: 1,
        timeout: 90000,
      });
      expect(reps.length).toBeGreaterThanOrEqual(1);

      // Allow log buffer to flush (tee pipe buffering)
      await page.waitForTimeout(3000);

      // Read the readmodel-orders container log from the shared volume
      const rawLog = readFileSync(LOG_FILE, 'utf-8');
      const lines = rawLog.split('\n').map(stripAnsi);

      // Find all log lines that contain a correlation ID bracket — these are
      // the lines emitted by getLogger(name, correlationId).info/debug/etc
      // Format: "timestamp [LoggerName     ] LEVEL: [CORR-ID] message"
      const corrNoneLines = lines.filter((l) => l.includes('[CORR-NONE]'));

      expect(
        corrNoneLines,
        `Found ${corrNoneLines.length} CORR-NONE log lines in readmodel-orders:\n${corrNoneLines.join('\n')}`,
      ).toHaveLength(0);

      // Sanity check: we should have correlated log lines from the side effects.
      // Reputation routing always logs at INFO level on ORDER_CREATED.
      const sideEffectLines = lines.filter(
        (l) =>
          l.includes('RM/ReputeRoute') ||
          l.includes('RM/ReputeReassess') ||
          l.includes('LLM/Repute') ||
          l.includes('LLM/TrendBG') ||
          l.includes('ReadMod/Side'),
      );
      expect(
        sideEffectLines.length,
        'Expected correlated log lines from side-effect execution',
      ).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
});
