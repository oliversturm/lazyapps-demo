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
    await request.get(`${adminURL}/api/admin/replayStatus/_hc/_healthcheck`);
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
 * Poll the read models endpoint until a specific read model reaches the
 * target lifecycle state, or until maxPolls is reached. Returns the final
 * state or null if timed out.
 */
const pollForState = async (
  request,
  serviceUrl,
  readModel,
  targetState,
  maxPolls = 30,
) => {
  for (let i = 0; i < maxPolls; i++) {
    const res = await request.get(`${serviceUrl}/admin/readmodels`);
    const models = await res.json();
    const model = models.find((r) => r.name === readModel);
    if (model && model.state === targetState) return model.state;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
};

/**
 * Ensure a read model is in 'live' state. If it is not live, activate it
 * via the admin API and poll until it reaches 'live'. This is needed because
 * when the admin section is configured, bootstrap enables lifecycle
 * management and read models start in 'waiting' state. Auto-activation may
 * not have completed by the time tests start running.
 */
export const ensureLive = async (request, rmInfo) => {
  const rmRes = await request.get(`${rmInfo.serviceUrl}/admin/readmodels`);
  const readModels = await rmRes.json();
  const rm = readModels.find((r) => r.name === rmInfo.name);

  if (rm && rm.state === 'live') return;

  await request.post(
    `${rmInfo.cpUrl}/admin/readmodels/${rmInfo.endpointName}/${rmInfo.name}/activate`,
  );
  const finalState = await pollForState(
    request,
    rmInfo.serviceUrl,
    rmInfo.name,
    'live',
  );
  if (finalState !== 'live')
    throw new Error(`Read model ${rmInfo.name} did not reach live state`);
};

/**
 * Wait for a replay to complete by polling the admin service's replay
 * orchestration status (/api/admin/replayStatus/:name).
 *
 * Two phases:
 * 1. Wait for the replay to start (status becomes non-idle). This handles
 *    the delay between clicking "Start Replay" in the UI and the admin
 *    backend actually beginning the replay. Bounded to 5 seconds — if
 *    status is still idle after that, assume the replay completed very
 *    quickly (possible with few events).
 * 2. Wait for the replay to finish (status reaches 'completed' or 'idle').
 */
export const waitForReplayComplete = async (
  request,
  rmInfo,
  maxWaitMs = 30000,
) => {
  const deadline = Date.now() + maxWaitMs;
  const statusUrl = `${rmInfo.cpUrl}/api/admin/replayStatus/${rmInfo.endpointName}/${rmInfo.name}`;

  // Phase 1: Wait for replay to start (up to 5 seconds)
  const startDeadline = Date.now() + 5000;
  let sawNonIdle = false;
  while (Date.now() < startDeadline) {
    const res = await request.get(statusUrl);
    const status = await res.json();
    if (status.status !== 'idle') {
      sawNonIdle = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  // Phase 2: Wait for orchestration to complete
  if (sawNonIdle) {
    while (Date.now() < deadline) {
      const res = await request.get(statusUrl);
      const status = await res.json();
      if (status.status === 'completed' || status.status === 'idle') break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  // Phase 3: Wait for projection handler to finish processing replay events.
  // The orchestration status may show 'completed' before the RM has finished
  // processing all replayed events through the event bus.
  while (Date.now() < deadline) {
    const res = await request.get(
      `${rmInfo.adminUrl}/admin/replay/${rmInfo.endpointName}/${rmInfo.name}/status`,
    );
    const status = await res.json();
    if (status.status === 'idle' || status.status === 'completed') return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error(
    `Replay did not complete within ${maxWaitMs}ms for ${rmInfo.name}`,
  );
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
    `${rmInfo.adminUrl}/admin/replay/${rmInfo.endpointName}/${rmInfo.name}/status`,
  );
  const rmStatus = await rmStatusRes.json();
  if (rmStatus.status === 'idle') return;

  // Force-clear the replay state via the reset endpoint
  await request.delete(
    `${rmInfo.adminUrl}/admin/replay/${rmInfo.endpointName}/${rmInfo.name}/state`,
  );
};
