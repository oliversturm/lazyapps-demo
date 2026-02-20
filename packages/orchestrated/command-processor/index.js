import { express } from '@lazyapps/express/command-receiver/index.js';
import { inmemory } from '@lazyapps/aggregatestore-inmemory';
import { mongodb } from '@lazyapps/eventstore-mongodb';
import { rabbitMq } from '@lazyapps/eventbus-rabbitmq/command-receiver/index.js';
import { start } from '@lazyapps/bootstrap';
import {
  createEncryption,
  vaultKeyStore,
  appRole,
} from '@lazyapps/encryption';
import {
  encryptionSchema,
  encryptionContexts,
} from '../common/encryption-config.js';
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
});

const customizeExpress = (context, app) => {
  app.post('/api/forget-subject', (req, res) => {
    const subjectId = req.body.subjectId;
    if (!subjectId) {
      res.status(400).json({ error: 'Missing subjectId' });
      return;
    }
    context
      .handleCommand(
        context.aggregateStore,
        context.eventStore,
        context.eventBus,
        'FORGET_SUBJECT',
        'subjectLifecycle',
        subjectId,
        {
          subjectId,
          subjectType: req.body.subjectType || 'customer',
          reason: req.body.reason || 'GDPR Article 17 request',
          requestedBy: req.body.requestedBy || 'demo-operator',
        },
        aggregates.subjectLifecycle.commands.FORGET_SUBJECT,
        req.auth,
        Date.now(),
        req.body.correlationId,
      )
      .then(() => res.json({ status: 'forgotten' }))
      .catch((err) => res.status(500).json({ error: err.message }));
  });

  app.post('/api/admin/rotate-context-key', (req, res) => {
    const contextName = req.body.contextName;
    if (!contextName) {
      res.status(400).json({ error: 'Missing contextName' });
      return;
    }
    encryption
      .then((enc) => enc.rotateContextKey(contextName))
      .then(() => res.json({ status: 'rotated', context: contextName }))
      .catch((err) => res.status(500).json({ error: err.message }));
  });
};

start({
  correlation: {
    serviceId: 'CMD',
  },
  encryption,
  commands: {
    receiver: express({
      port: process.env.EXPRESS_PORT || 3001,
      customizeExpress,
    }),
    aggregateStore: inmemory(),
    eventStore: mongodb({
      url: process.env.MONGO_URL || 'mongodb://127.0.0.1:27017',
    }),
    eventBus: rabbitMq({
      url: process.env.RABBIT_URL || 'amqp://localhost',
      topic: 'events',
    }),
    aggregates,
    commandRecording: commandRecordingConfig,
  },
});
