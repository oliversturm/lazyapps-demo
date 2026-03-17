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
  await request.get(`${adminURL}/admin/readmodel/status`);
};

/**
 * Verify the admin UI is loaded in the browser. The admin UI has SSR
 * disabled, so content only appears after client-side JS executes.
 * Using 'load' ensures all scripts are fetched before we check.
 */
export const waitForAdminUI = async (page, adminURL) => {
  await page.goto(adminURL, { waitUntil: 'load' });
  // Admin UI has SSR disabled — content only appears after client-side JS executes
  await page.getByText('LazyApps Admin').waitFor();
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
        endpointName: 'customers',
        service: 'readmodel-customers',
        serviceUrl: 'http://readmodel-customers',
        adminUrl: 'http://admin-ui:3000',
        cpUrl: 'http://admin-ui:3000',
      },
      ordersOverview: {
        name: 'overview',
        endpointName: 'orders',
        service: 'readmodel-orders',
        serviceUrl: 'http://readmodel-orders',
        adminUrl: 'http://admin-ui:3000',
        cpUrl: 'http://admin-ui:3000',
      },
    };
  }
  return {
    customersOverview: {
      name: 'customersOverview',
      endpointName: 'monolith',
      service: 'monolith',
      serviceUrl: 'http://monolith:3005',
      adminUrl: 'http://monolith:3005',
      cpUrl: 'http://monolith:3005',
    },
    ordersOverview: {
      name: 'ordersOverview',
      endpointName: 'monolith',
      service: 'monolith',
      serviceUrl: 'http://monolith:3005',
      adminUrl: 'http://monolith:3005',
      cpUrl: 'http://monolith:3005',
    },
  };
};

/**
 * Find a read model row in the Read Models table. In orchestrated mode,
 * short names like "overview" appear in multiple endpoints, so we also
 * match on the endpointName column for disambiguation.
 */
export const findReadModelRow = (page, rmInfo) => {
  const row = page.locator('tr', {
    has: page.getByText(rmInfo.name, { exact: true }),
  });
  if (rmInfo.endpointName) {
    return row.filter({
      has: page.getByText(rmInfo.endpointName, { exact: true }),
    });
  }
  return row;
};

/**
 * Poll the read model status endpoint until a specific read model reaches the
 * target lifecycle state, or until maxPolls is reached. Returns the final
 * state or null if timed out.
 */
const pollForState = async (
  request,
  adminUrl,
  endpointName,
  readModel,
  targetState,
  maxPolls = 30,
) => {
  for (let i = 0; i < maxPolls; i++) {
    const res = await request.get(
      `${adminUrl}/admin/readmodel/status/${endpointName}/${readModel}`,
    );
    const status = await res.json();
    if (status && status.state === targetState) return status.state;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
};

/**
 * Ensure a read model is in 'live' state. If it is not live, activate it
 * via the admin API and poll until it reaches 'live'. This is needed because
 * when the admin section is configured, bootstrap enables lifecycle
 * management and read models start in 'stopped' state. Auto-activation may
 * not have completed by the time tests start running.
 */
export const ensureLive = async (request, rmInfo) => {
  // Poll until the admin status cache has this RM (may take a moment
  // during startup while SSE discovery and auto-activation are in progress)
  for (let i = 0; i < 30; i++) {
    const res = await request.get(
      `${rmInfo.adminUrl}/admin/readmodel/status/${rmInfo.endpointName}/${rmInfo.name}`,
    );
    if (res.ok()) {
      const status = await res.json();
      if (status && status.state === 'live') return;
      if (status && status.state) break; // cache populated, not live yet
    }
    // 404 = cache not yet populated, wait for it
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // If still not live, try to activate (auto-activation may have failed)
  const checkRes = await request.get(
    `${rmInfo.adminUrl}/admin/readmodel/status/${rmInfo.endpointName}/${rmInfo.name}`,
  );
  if (checkRes.ok()) {
    const checkStatus = await checkRes.json();
    if (checkStatus && checkStatus.state === 'live') return;
  }

  await request.post(
    `${rmInfo.cpUrl}/admin/readmodel/activate/${rmInfo.endpointName}/${rmInfo.name}`,
  );
  const finalState = await pollForState(
    request,
    rmInfo.adminUrl,
    rmInfo.endpointName,
    rmInfo.name,
    'live',
  );
  if (finalState !== 'live')
    throw new Error(`Read model ${rmInfo.name} did not reach live state`);
};

/**
 * Wait for a replay to complete by polling the admin readmodel status endpoint.
 *
 * Replay flow: state goes from 'stopped' → 'replay' → 'stopped' (replayDone)
 * → 'live' (after activation). We wait for 'stopped' or 'live' state.
 */
export const waitForReplayComplete = async (
  request,
  rmInfo,
  maxWaitMs = 30000,
) => {
  const deadline = Date.now() + maxWaitMs;
  const statusUrl = `${rmInfo.adminUrl}/admin/readmodel/status/${rmInfo.endpointName}/${rmInfo.name}`;

  // Wait for state to reach 'stopped' (replay done) or 'live' (activated after replay)
  while (Date.now() < deadline) {
    const res = await request.get(statusUrl);
    const status = await res.json();
    if (status.state === 'stopped' || status.state === 'live') return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error(
    `Replay did not complete within ${maxWaitMs}ms for ${rmInfo.name}`,
  );
};

/**
 * Ensure a read model is not stuck in a stale replay state. If the RM is
 * in 'replay' state, cancel via admin API. If 'stopped' or 'live', it's clean.
 */
export const ensureCleanReplayState = async (request, rmInfo) => {
  const res = await request.get(
    `${rmInfo.adminUrl}/admin/readmodel/status/${rmInfo.endpointName}/${rmInfo.name}`,
  );
  const status = await res.json();
  if (!status || status.state !== 'replay') return;

  // Cancel the in-progress replay
  await request.post(
    `${rmInfo.adminUrl}/admin/replay/cancel/${rmInfo.endpointName}/${rmInfo.name}`,
    { data: { reset: true } },
  );
};
