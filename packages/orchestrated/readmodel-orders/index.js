import { express } from '@lazyapps/express/readmodels/index.js';
import { mongodb } from '@lazyapps/readmodelstorage-mongodb';
import { rabbitMq } from '@lazyapps/eventbus-rabbitmq/readmodels/index.js';
import { changeNotificationSenderFetch } from '@lazyapps/change-notification-sender-fetch';
import { start } from '@lazyapps/bootstrap';
import * as readModels from './readmodels/index.js';
import { commandSenderFetch } from '@lazyapps/command-sender-fetch';
import { getLogger } from '@lazyapps/logger';
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
import { jwtSecret, jwtAlgorithms } from '../common/jwt-config.js';

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
      jwtSecret,
      jwtAlgorithms,
      customizeExpress,
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
    }),
    commandSender: commandSenderFetch({
      url: process.env.COMMAND_URL,
      jwt: (() => {
        const log = getLogger('RM/ORD/JWT', 'INIT');
        const tokenUrl =
          process.env.KEYCLOAK_TOKEN_URL ||
          'http://keycloak:8080/realms/lazyapps-demo/protocol/openid-connect/token';
        const clientId = process.env.SERVICE_CLIENT_ID || 'lazyapps-service';
        const clientSecret =
          process.env.SERVICE_CLIENT_SECRET || 'service-account-secret';
        let cached = null;
        let expiresAt = 0;
        return () => {
          if (cached && Date.now() < expiresAt) return Promise.resolve(cached);
          return fetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`,
          })
            .then((res) =>
              res.ok
                ? res.json()
                : res.text().then((t) => {
                    throw new Error(`Token fetch failed: ${res.status} ${t}`);
                  }),
            )
            .then((data) => {
              cached = data.access_token;
              // Refresh 30 seconds before expiry
              expiresAt = Date.now() + (data.expires_in - 30) * 1000;
              log.info('Service account token acquired');
              return cached;
            });
        };
      })(),
    }),
    readModels,
  },
});
