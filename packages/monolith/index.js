import { inmemory } from '@lazyapps/aggregatestore-inmemory';
import { mongodb as eventStoreMongo } from '@lazyapps/eventstore-mongodb';
import { mongodb as readModelStorageMongo } from '@lazyapps/readmodelstorage-mongodb';
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
import { rateLimit } from 'express-rate-limit';
import * as aggregates from './aggregates/index.js';
import * as readModels from './readmodels/index.js';
import { getLogger, configurePiiPaths } from '@lazyapps/logger';

configurePiiPaths(['payload.name']);

const log = getLogger('Monolith', 'INIT');

log.debug('Starting up');

const mqCommandsPort = process.env.MQ_COMMANDS_PORT || 51883;
const mqQueriesPort = process.env.MQ_QUERIES_PORT || 51884;

// Demo rate limiter: 100 requests per IP per minute. In a real deployment
// this would be tuned per-endpoint and likely backed by a shared store
// (Redis, Memcached) so limits apply across replicas.
const rateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

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
    eventStore: eventStoreMongo({
      url: process.env.MONGO_URL || 'mongodb://127.0.0.1:27017',
    }),
    eventBus: commandProcessorEventBusMqEmitter({ mqName: 'events' }),
    aggregates,
  },
  readModels: {
    listener: readModelListenerMqEmitter({ mqName: 'queries' }),
    storage: readModelStorageMongo({
      url: process.env.MONGO_URL || 'mongodb://127.0.0.1:27017',
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
      fetchTimeoutMs: 5000,
    }),
    commandSender: commandSenderMqEmitter({ mqName: 'commands' }),
    readModels,
  },
  changeNotifier: {
    listener: changeNotifierExpress({
      port: 53008,
      // E2E runs the monolith in a Docker network where the browser's
      // Origin header is `http://monolith:5173` (see
      // tests/e2e/docker-compose.monolith.yml). Local `pnpm mono:start`
      // leaves CORS_ORIGIN unset and falls back to the SvelteKit dev
      // server's default origin on localhost.
      corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
      bodyLimit: '100kb',
      helmet: true,
      rateLimiter,
    }),
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
});
