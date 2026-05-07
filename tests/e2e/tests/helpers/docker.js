import { execSync } from 'node:child_process';

/**
 * Safe container control helper for E2E failure-recovery tests.
 *
 * Every operation filters by Docker Compose project label to ensure
 * we never touch containers outside our own project.
 */

const getProjectName = () => {
  // Docker Compose sets COMPOSE_PROJECT_NAME, or derives it from the
  // directory name. Try the env var first, then detect from running
  // containers.
  if (process.env.COMPOSE_PROJECT_NAME) return process.env.COMPOSE_PROJECT_NAME;

  // Detect by inspecting any container with a compose label
  try {
    const output = execSync(
      'docker ps --filter "label=com.docker.compose.project" ' +
        '--format "{{.Label \\"com.docker.compose.project\\"}}" ' +
        '| head -1',
      { encoding: 'utf-8', timeout: 5000 },
    ).trim();
    if (output) return output;
  } catch {
    // fall through
  }

  throw new Error(
    'Cannot determine Docker Compose project name. ' +
      'Set COMPOSE_PROJECT_NAME or ensure compose containers are running.',
  );
};

let cachedProject = null;
const project = () => {
  if (!cachedProject) cachedProject = getProjectName();
  return cachedProject;
};

const log = (msg) => {
  // eslint-disable-next-line no-console
  console.log(`[docker-helper] ${msg}`);
};

/**
 * List containers belonging to our compose project.
 * Returns an array of { id, name, service, state, health } objects.
 */
export const getProjectContainers = () => {
  const p = project();
  const output = execSync(
    `docker ps -a --filter "label=com.docker.compose.project=${p}" ` +
      '--format "{{.ID}}|{{.Names}}|{{.Label \\"com.docker.compose.service\\"}}|{{.State}}|{{.Status}}"',
    { encoding: 'utf-8', timeout: 10000 },
  ).trim();

  if (!output) return [];

  return output.split('\n').map((line) => {
    const [id, name, service, state, status] = line.split('|');
    return {
      id,
      name,
      service,
      state,
      health: status.includes('(healthy)')
        ? 'healthy'
        : status.includes('(unhealthy)')
          ? 'unhealthy'
          : 'unknown',
    };
  });
};

/**
 * Find a container by service name, verifying it belongs to our project.
 */
const findContainer = (serviceName) => {
  const containers = getProjectContainers();
  const match = containers.find((c) => c.service === serviceName);
  if (!match) {
    throw new Error(
      `No container found for service '${serviceName}' in project '${project()}'`,
    );
  }
  return match;
};

/**
 * SIGKILL a service container to simulate a crash.
 * Uses docker kill (not stop) for immediate termination without cleanup.
 */
export const killService = (serviceName) => {
  const container = findContainer(serviceName);
  log(`Killing service '${serviceName}' (container ${container.id})`);
  execSync(`docker kill ${container.id}`, {
    encoding: 'utf-8',
    timeout: 10000,
  });
  log(`Killed service '${serviceName}'`);
};

/**
 * Start a previously killed service container.
 */
export const startService = (serviceName) => {
  const container = findContainer(serviceName);
  log(`Starting service '${serviceName}' (container ${container.id})`);
  execSync(`docker start ${container.id}`, {
    encoding: 'utf-8',
    timeout: 30000,
  });
  log(`Started service '${serviceName}'`);
};

/**
 * Poll until a service container is healthy.
 * Returns true if healthy within the timeout, false otherwise.
 */
export const waitForServiceHealthy = async (serviceName, timeoutMs = 60000) => {
  const deadline = Date.now() + timeoutMs;
  log(`Waiting for service '${serviceName}' to become healthy (timeout ${timeoutMs}ms)`);

  while (Date.now() < deadline) {
    try {
      const container = findContainer(serviceName);
      if (container.state === 'running' && container.health === 'healthy') {
        log(`Service '${serviceName}' is healthy`);
        return true;
      }
    } catch {
      // Container might not exist yet during restart
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  log(`Timeout waiting for service '${serviceName}' to become healthy`);
  return false;
};
