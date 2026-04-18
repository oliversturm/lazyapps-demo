import { express } from '@lazyapps/express/readmodels/index.js';
import { mongodb } from '@lazyapps/readmodelstorage-mongodb';
import { rabbitMq } from '@lazyapps/eventbus-rabbitmq/readmodels/index.js';
import { changeNotificationSenderFetch } from '@lazyapps/change-notification-sender-fetch';
import { start } from '@lazyapps/bootstrap';
import * as readModels from './readmodels/index.js';
import { commandSenderFetch } from '@lazyapps/command-sender-fetch';
import { configurePiiPaths } from '@lazyapps/logger';
import { customizeExpress } from './graphql-server.js';
import {
  createEncryption,
  vaultKeyStore,
  appRole,
  customMapper,
} from '@lazyapps/encryption';
import {
  encryptionSchema,
  encryptionContexts,
  readModelEncryptionConfig,
} from '../common/encryption-config.js';
import { jwtAuth, jwtAlgorithms } from '../common/jwt-config.js';
import { createServiceTokenProvider } from '../common/service-token.js';
import { rateLimit } from 'express-rate-limit';

configurePiiPaths(encryptionSchema.getPiiPaths());

// Demo rate limiter: 100 requests per IP per minute.
const rateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

const encryption = createEncryption({
  schema: encryptionSchema,
  keyStore: vaultKeyStore({
    vaultUrl: process.env.VAULT_ADDR || 'http://vault:8200',
    authMethod: appRole({
      roleId: process.env.VAULT_ROLE_ID,
      secretId: process.env.VAULT_SECRET_ID,
    }),
  }),
  contexts: encryptionContexts,
  readModelEncryption: readModelEncryptionConfig,
});

start({
  correlation: {
    serviceId: 'RM/ORD',
  },
  encryption,
  readModels: {
    role: 'order-service',
    jwtScopeMapper: customMapper((auth) => ({
      roles: (auth && auth.realm_access && auth.realm_access.roles) || [],
      identity: auth && auth.sub,
    })),
    listener: express({
      port: process.env.EXPRESS_PORT || 3005,
      jwtAuth,
      jwtAlgorithms,
      credentialsRequired: true,
      customizeExpress,
      corsOrigin: ['http://svelte.localhost', 'http://react.localhost'],
      bodyLimit: '100kb',
      helmet: true,
      rateLimiter,
    }),
    storage: mongodb({
      url: process.env.MONGO_URL || 'mongodb://127.0.0.1:27017',
      database: process.env.MONGO_DATABASE || 'readmodel-orders',
    }),
    eventBus: rabbitMq({
      url: process.env.RABBIT_URL || 'amqp://localhost',
      pattern: 'events',
    }),
    changeNotificationSender: changeNotificationSenderFetch({
      url:
        process.env.CHANGENOTIFICATION_FETCH_URL ||
        'http://localhost:3008/change',
      jwt: createServiceTokenProvider({ label: 'RM/ORD/JWT' }),
      fetchTimeoutMs: 5000,
    }),
    commandSender: commandSenderFetch({
      url: process.env.COMMAND_URL,
      jwt: createServiceTokenProvider({ label: 'RM/ORD/CMD-JWT' }),
      fetchTimeoutMs: 5000,
    }),
    readModels,
  },
});
