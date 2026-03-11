/**
 * Derive the admin API URL from the app's baseURL.
 * For monolith: admin runs on port 3005 of the same host.
 * For orchestrated: admin-ui is a separate container.
 */
export const getAdminURL = (baseURL) => {
  const url = new URL(baseURL);
  if (
    url.hostname === 'frontend-svelte' ||
    url.hostname === 'frontend-react'
  ) {
    return 'http://admin-ui:3000';
  }
  url.port = '3005';
  return url.origin;
};

/**
 * Verify the admin service is responding. Docker health checks guarantee
 * the service is up, so a single request is sufficient.
 */
export const waitForAdmin = async (request, adminURL) => {
  const url = new URL(adminURL);
  if (url.hostname === 'admin-ui') {
    // Orchestrated: admin-ui doesn't serve backend API endpoints
    await request.get(adminURL);
  } else {
    // Monolith: verify admin API is ready
    await request.get(`${adminURL}/api/admin/replayStatus/_healthcheck`);
  }
};

/**
 * Verify the admin UI is loaded in the browser. The admin UI has SSR
 * disabled, so content only appears after client-side JS executes.
 * Using 'load' ensures all scripts are fetched before we check.
 */
export const waitForAdminUI = async (page, adminURL) => {
  await page.goto(adminURL, { waitUntil: 'load' });
  // Admin UI has SSR disabled — content only appears after client-side JS executes
  await page.getByText('LazyApps Admin').waitFor({ timeout: 5000 });
};

/**
 * Determine whether the current deployment is orchestrated (separate services)
 * vs monolith (all in one process). Orchestrated services use short read model
 * names (e.g. "overview") while the monolith uses fully-qualified names
 * (e.g. "customersOverview").
 */
export const isOrchestrated = (baseURL) => {
  const url = new URL(baseURL);
  return (
    url.hostname === 'frontend-svelte' || url.hostname === 'frontend-react'
  );
};

/**
 * Get read model configuration for the current deployment mode.
 * Returns the read model name, service name, and backend URLs needed
 * for API calls and row disambiguation in the admin UI.
 */
export const getReadModelConfig = (baseURL) => {
  if (isOrchestrated(baseURL)) {
    return {
      customersOverview: {
        name: 'overview',
        service: 'readmodel-customers',
        serviceUrl: 'http://readmodel-customers',
        cpUrl: 'http://admin-ui:3000',
      },
      ordersOverview: {
        name: 'overview',
        service: 'readmodel-orders',
        serviceUrl: 'http://readmodel-orders',
        cpUrl: 'http://admin-ui:3000',
      },
    };
  }
  return {
    customersOverview: {
      name: 'customersOverview',
      service: 'monolith',
      serviceUrl: 'http://monolith:3005',
      cpUrl: 'http://monolith:3005',
    },
    ordersOverview: {
      name: 'ordersOverview',
      service: 'monolith',
      serviceUrl: 'http://monolith:3005',
      cpUrl: 'http://monolith:3005',
    },
  };
};

/**
 * Find a read model row in the Read Models table. In orchestrated mode,
 * short names like "overview" appear in multiple services, so we also
 * match on the service column for disambiguation.
 */
export const findReadModelRow = (page, rmInfo) => {
  const row = page.locator('tr', {
    has: page.getByText(rmInfo.name, { exact: true }),
  });
  if (rmInfo.service) {
    return row.filter({
      has: page.getByText(rmInfo.service, { exact: true }),
    });
  }
  return row;
};

/**
 * Ensure a read model is not stuck in a stale replay state. This can happen
 * when a test calls `prepare` but fails before the replay completes or is
 * cancelled. The prepare step sets the in-memory replay flag in the admin
 * service's projection handler, but REPLAY_EVENTS_DONE only clears the
 * read models' projection handler (a separate instance in monolith mode).
 *
 * Uses the DELETE /admin/replay/:name/state endpoint to force-clear the
 * admin's projection handler state.
 */
export const ensureCleanReplayState = async (request, rmInfo) => {
  const rmStatusRes = await request.get(
    `${rmInfo.serviceUrl}/admin/replay/${rmInfo.name}/status`,
  );
  const rmStatus = await rmStatusRes.json();
  if (rmStatus.status === 'idle') return;

  // Force-clear the replay state via the reset endpoint
  await request.delete(
    `${rmInfo.serviceUrl}/admin/replay/${rmInfo.name}/state`,
  );
};
