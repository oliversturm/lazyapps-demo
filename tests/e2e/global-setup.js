import { MongoClient } from 'mongodb';
import { execSync } from 'child_process';

const COMPOSE_FILE =
  '../../packages/orchestrated/compose.yml';

const globalSetup = async () => {
  // When running monolith-only tests inside Docker, the orchestrated
  // stack isn't available. Skip the DB reset and service restart.
  const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017';

  let client;
  try {
    client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 3000 });
    await client.connect();
  } catch {
    // MongoDB not reachable (e.g. monolith-only Docker run) — skip reset.
    return;
  }

  try {
    // Drop all databases to ensure clean state across test runs.
    for (const dbName of [
      'readmodel-customers',
      'readmodel-orders',
      'events',
    ]) {
      await client.db(dbName).dropDatabase();
    }
  } finally {
    await client.close();
  }

  // Restart application services so their in-memory aggregate caches
  // are cleared and they reconnect to the now-empty databases.
  try {
    execSync(
      `docker compose -f ${COMPOSE_FILE} restart command-processor readmodel-customers readmodel-orders change-notifier`,
      { stdio: 'inherit', timeout: 60000 },
    );

    // Wait for services to be ready after restart.
    await new Promise((r) => setTimeout(r, 5000));
  } catch {
    // Docker compose not available (e.g. running inside container) — skip.
  }
};

export default globalSetup;
