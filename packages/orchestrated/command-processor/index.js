import { express } from '@lazyapps/express/command-receiver/index.js';
import { inmemory } from '@lazyapps/aggregatestore-inmemory';
import { mongodb } from '@lazyapps/eventstore-mongodb';
import { rabbitMq } from '@lazyapps/eventbus-rabbitmq/command-receiver/index.js';
import { start } from '@lazyapps/bootstrap';
import { createEncryption, vaultKeyStore, appRole } from '@lazyapps/encryption';
import {
  encryptionSchema,
  encryptionContexts,
  encryptionSubjects,
} from '../common/encryption-config.js';
import { jwtSecret, jwtAlgorithms } from '../common/jwt-config.js';
import * as aggregates from './aggregates/index.js';
import path from 'path';

// Configure command recording based on COMMAND_RECORD_PATH
const commandRecordingConfig = process.env.COMMAND_RECORD_PATH
  ? {
      enabled: true,
      skipAuthCheck: true,
      filePath: path.join(
        process.env.COMMAND_RECORD_PATH,
        `commands-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      ),
    }
  : null;

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
  subjects: encryptionSubjects,
});

start({
  correlation: {
    serviceId: 'CMD',
  },
  encryption,
  commands: {
    receiver: express({
      port: process.env.EXPRESS_PORT || 3001,
      jwtSecret,
      jwtAlgorithms,
    }),
    aggregateStore: inmemory(),
    eventStore: mongodb({
      url: process.env.MONGO_URL || 'mongodb://127.0.0.1:27017',
    }),
    eventBus: rabbitMq({
      url: process.env.RABBIT_URL || 'amqp://localhost',
      topic: 'events',
    }),
    aggregates: {
      ...aggregates,
    },
    commandRecording: commandRecordingConfig,
  },
});
