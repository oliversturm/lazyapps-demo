import { test, expect } from '@playwright/test';
import {
  getAdminURL,
  waitForAdmin,
  waitForAdminUI,
  isOrchestrated,
} from './helpers/admin.js';
import { getServiceLogs } from './helpers/docker.js';

// The admin service establishes its SSE subscriptions to RM/CP services on
// demand (first browser connect or admin operation) and tears them down
// after an idle grace period. The e2e compose sets SSE_IDLE_GRACE_MS=3000.
//
// Lifecycle transitions are observed through the admin service's logs:
// every connect cycle logs "Starting SSE subscriptions", every teardown
// logs "Closing all SSE subscriptions". Quiescent (no upstream SSE) means
// both counts are equal; connected means starts lead closes by one.
const GRACE_MS = 3000;

const adminServiceName = (baseURL) =>
  isOrchestrated(baseURL) ? 'admin-ui' : 'monolith';

const sseCounts = (service) => {
  const logs = getServiceLogs(service);
  return {
    starts: (logs.match(/Starting SSE subscriptions/g) || []).length,
    closes: (logs.match(/Closing all SSE subscriptions/g) || []).length,
    idleTeardowns: (logs.match(/Idle grace period .* elapsed/g) || []).length,
  };
};

const pollUntil = async (fn, timeoutMs, label) => {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = fn();
    if (last.done) return last;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timeout waiting for ${label}: ${JSON.stringify(last)}`);
};

test.describe('Admin SSE on-demand lifecycle', () => {
  test('auto-activation ran as an operation and went quiet afterwards', async ({
    request,
    baseURL,
  }) => {
    const adminURL = getAdminURL(baseURL);
    await waitForAdmin(request, adminURL);
    const service = adminServiceName(baseURL);

    // Auto-activation at boot brings SSE up; after it completes and the
    // idle grace elapses, the subscriptions must have been torn down at
    // least once. These log lines are historical facts — no waiting
    // required by the time the suite reaches this spec.
    const counts = sseCounts(service);
    expect(counts.starts).toBeGreaterThanOrEqual(1);
    expect(counts.idleTeardowns).toBeGreaterThanOrEqual(1);
    expect(counts.closes).toBeGreaterThanOrEqual(1);
  });

  test('status endpoint serves fresh data while no SSE is connected', async ({
    request,
    baseURL,
  }) => {
    const adminURL = getAdminURL(baseURL);
    await waitForAdmin(request, adminURL);

    // Regardless of current SSE state, a plain status read must return
    // populated, current read model data (cache refreshes on demand)
    const response = await request.get(`${adminURL}/admin/readmodel/status`);
    expect(response.ok()).toBeTruthy();
    const readModels = await response.json();
    expect(readModels.length).toBeGreaterThan(0);
    for (const rm of readModels) {
      expect(rm).toHaveProperty('state');
      expect(rm).toHaveProperty('lastProjectedEventTimestamp');
    }
  });

  test('emits browser-SSE heartbeats on the wire (#16)', async ({
    request,
    baseURL,
  }) => {
    const adminURL = getAdminURL(baseURL);
    await waitForAdmin(request, adminURL);

    // Heartbeats are SSE comments (":heartbeat"), invisible to EventSource,
    // so read the raw /admin/events body and confirm one arrives. The e2e
    // compose sets SSE_HEARTBEAT_MS=1000 so this is observable in ~1s rather
    // than the 15s library default. A heartbeat write reaching the socket is
    // exactly the mechanism that lets a dead browser connection release its
    // refcount (#16).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let sawHeartbeat = false;
    try {
      const res = await fetch(`${adminURL}/admin/events`, {
        signal: controller.signal,
        headers: { Accept: 'text/event-stream' },
      });
      expect(res.ok).toBeTruthy();

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.includes(':heartbeat')) {
          sawHeartbeat = true;
          break;
        }
      }
      reader.cancel().catch(() => {});
    } catch (err) {
      // A timeout aborts the read; fall through to a clean assertion below.
      if (err.name !== 'AbortError') throw err;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }

    expect(sawHeartbeat).toBeTruthy();
  });

  test('browser connect brings SSE up, disconnect tears down after grace', async ({
    browser,
    request,
    baseURL,
  }) => {
    // This test deliberately waits through two idle grace periods
    // (2 x SSE_IDLE_GRACE_MS = 3s) — the teardown delay is the feature
    // under test, not infrastructure slack.
    test.setTimeout(30000);

    const adminURL = getAdminURL(baseURL);
    await waitForAdmin(request, adminURL);
    const service = adminServiceName(baseURL);

    // Step 1: wait for quiescence — any SSE cycle left over from earlier
    // specs (their dashboard pages) finishes tearing down within one grace
    await pollUntil(
      () => {
        const c = sseCounts(service);
        return { done: c.starts === c.closes, ...c };
      },
      GRACE_MS + 5000,
      'SSE quiescence before browser connect',
    );
    const before = sseCounts(service);

    // Step 2: open the admin dashboard — the browser SSE attach must
    // bring the upstream subscriptions up (a new connect cycle)
    const context = await browser.newContext();
    const page = await context.newPage();
    await waitForAdminUI(page, adminURL);
    await pollUntil(
      () => {
        const c = sseCounts(service);
        return { done: c.starts === before.starts + 1, ...c };
      },
      5000,
      'SSE connect after dashboard open',
    );

    // The dashboard shows live read model data through the fresh connect
    await expect(page.getByText('LazyApps Admin')).toBeVisible();

    // Step 3: close the browser — after the last client disconnects and
    // the grace period elapses, the subscriptions are torn down again
    await context.close();
    await pollUntil(
      () => {
        const c = sseCounts(service);
        return { done: c.closes === before.closes + 1, ...c };
      },
      GRACE_MS + 5000,
      'SSE teardown after dashboard close',
    );
  });
});
