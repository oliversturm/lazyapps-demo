import { inmemory } from '@lazyapps/aggregatestore-inmemory';
import { mongodb as eventStoreMongo } from '@lazyapps/eventstore-mongodb';
import { mongodb as readModelStorageMongo } from '@lazyapps/readmodelstorage-mongodb';
import { backup } from '@lazyapps/readmodelstorage-mongodb/backup.js';
import { start } from '@lazyapps/bootstrap';
import mqemitter from 'mqemitter';
import {
  commandReceiverMqEmitter,
  commandProcessorEventBusMqEmitter,
  readModelEventBusMqEmitter,
  commandSenderMqEmitter,
  readModelListenerMqEmitter,
  registerSharedMqEmitter,
} from '@lazyapps/mqemitter';
import { express as changeNotifierExpress } from '@lazyapps/change-notifier-socket-io';
import { changeNotificationSenderFetch } from '@lazyapps/change-notification-sender-fetch';
import { filesystemTimestampStorage } from '@lazyapps/readmodels/secondaryTimestampStorage.js';
import * as aggregates from './aggregates/index.js';
import * as readModels from './readmodels/index.js';
import { getLogger } from '@lazyapps/logger';

const log = getLogger('Monolith', 'INIT');

log.debug('Starting up');

const mqCommandsPort = process.env.MQ_COMMANDS_PORT || 51883;
const mqQueriesPort = process.env.MQ_QUERIES_PORT || 51884;
const mongoUrl = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017';
const adminPort = process.env.ADMIN_PORT || 3005;
const backupPath = process.env.BACKUP_PATH || './backup';
const developmentMode = process.env.DEVELOPMENT_MODE === 'true';
// Idle grace before the admin service tears down its on-demand SSE
// subscriptions (ms). E2E tests set this low to observe the lifecycle.
const sseIdleGraceMs = process.env.SSE_IDLE_GRACE_MS
  ? Number(process.env.SSE_IDLE_GRACE_MS)
  : undefined;
const secondaryTsPath = process.env.SECONDARY_TS_PATH || './secondary-timestamps';
const svelteHost = process.env.SVELTE_HOST || 'localhost';
const sveltePort = 5173;

// When running locally, MongoDB is a standalone Docker container started
// via `pnpm start-mongo`. Backup tools must run inside that container
// via `docker exec`, and the backup volume is mounted at /backup.
// When running inside Docker (e.g. e2e tests), the monolith container
// has direct access to MongoDB and has mongodump/mongorestore installed
// locally, so no docker exec is needed.
const useDockerExec = !process.env.MONGO_URL;
const dockerExecPrefix = ['docker', 'exec', 'mongo'];
const mongoBackup = backup({
  backupPath,
  ...(useDockerExec && {
    mongodumpCommand: [...dockerExecPrefix, 'mongodump'],
    mongorestoreCommand: [...dockerExecPrefix, 'mongorestore'],
    mongoexportCommand: [...dockerExecPrefix, 'mongoexport'],
    mongoimportCommand: [...dockerExecPrefix, 'mongoimport'],
    toolBackupPath: '/backup',
  }),
});

// The activator queries read model state via HTTP. In the monolith, the
// admin server and the read model listener share the same process. Pointing
// the activator at the admin server's own port would cause infinite HTTP
// recursion (readModelsHandler → activator → fetchReadModels → readModelsHandler).
// Instead, route through the SvelteKit backend which bridges to the shared
// 'queries' mqemitter via mqemitter-cs TCP (same pattern as data queries).
const readModelServiceUrl = `http://${svelteHost === '0.0.0.0' ? '127.0.0.1' : svelteHost}:${sveltePort}/api`;

registerSharedMqEmitter('commands', mqemitter(), mqCommandsPort);
registerSharedMqEmitter('events', mqemitter());
registerSharedMqEmitter('queries', mqemitter(), mqQueriesPort);

start({
  correlation: {
    serviceId: 'MONO',
  },
  commands: {
    receiver: commandReceiverMqEmitter({ mqName: 'commands' }),
    aggregateStore: inmemory(),
    eventStore: eventStoreMongo({ url: mongoUrl }),
    eventBus: commandProcessorEventBusMqEmitter({ mqName: 'events' }),
    aggregates,
  },
  readModels: {
    listener: readModelListenerMqEmitter({ mqName: 'queries' }),
    storage: readModelStorageMongo({
      url: mongoUrl,
      database: 'monolith-readmodels',
    }),
    eventBus: readModelEventBusMqEmitter({ mqName: 'events' }),

    // I think it makes sense to use the
    // existing change notifier here.
    // It listens on HTTP and it sends
    // changes to the client through
    // socket.io. The thing is that the
    // change info must come to the web
    // app's client side, and that cannot
    // be achieved through mqemitter
    // anyway -- so we would always need
    // socket.io unless we wanted to invent
    // something completely different.
    // This in turn means that we'll need
    // a server like express in the change
    // notifier service, and if we have that
    // then why not use it as a receiver
    // for the change notifications
    // originating from the read models?

    // Add this back in when the change
    // notifier has been added.
    //
    changeNotificationSender: changeNotificationSenderFetch({
      url: 'http://127.0.0.1:53008/change',
    }),
    commandSender: commandSenderMqEmitter({ mqName: 'commands' }),
    backup: mongoBackup,
    endpointName: 'monolith',
    developmentMode,
    secondaryTimestampStorage: filesystemTimestampStorage(secondaryTsPath),
    readModels,
  },
  changeNotifier: {
    listener: changeNotifierExpress({ port: 53008 }),
  },
  svelte: {
    port: 5173,
    host: process.env.SVELTE_HOST || 'localhost',
    allowedHosts: process.env.SVELTE_HOST === '0.0.0.0' ? true : undefined,
    mqCommandsPort,
    mqQueriesPort,
    // future plan: add a way to specify the
    // path prefix for the frontend project

    // second future plan: add other startup
    // options. For instance, I could build
    // and then run preview. Or build and
    // run with Node adapter. Not sure
    // we need both?
  },
  admin: {
    port: adminPort,
    eventBus: commandProcessorEventBusMqEmitter({ mqName: 'events' }),
    readModelServiceUrl,
    autoActivate: true,
    developmentMode,
    sseIdleGraceMs,
  },
});
