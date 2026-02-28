/**
 * Derive the admin API URL from the app's baseURL (same hostname, port 3005).
 */
export const getAdminURL = (baseURL) => {
  const url = new URL(baseURL);
  url.port = '3005';
  return url.origin;
};

/**
 * Verify the admin API server is responding. Docker health checks guarantee
 * the service is up, so a single request is sufficient.
 */
export const waitForAdmin = async (request, adminURL) => {
  await request.get(`${adminURL}/api/admin/replayStatus/_healthcheck`);
};

/**
 * Verify the admin UI is loaded in the browser. The admin UI has SSR
 * disabled, so content only appears after client-side JS executes.
 * Using 'load' ensures all scripts are fetched before we check.
 */
export const waitForAdminUI = async (page, adminURL) => {
  await page.goto(adminURL, { waitUntil: 'load' });
  await page.getByText('LazyApps Admin').waitFor();
};
