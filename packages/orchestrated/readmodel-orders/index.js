import { express } from '@lazyapps/express/readmodels/index.js';
import { mongodb } from '@lazyapps/readmodelstorage-mongodb';
import { rabbitMq } from '@lazyapps/eventbus-rabbitmq/readmodels/index.js';
import { changeNotificationSenderFetch } from '@lazyapps/change-notification-sender-fetch';
import { installReadModelStatusApi } from '@lazyapps/admin-api';
import { installAdminEndpoints } from '@lazyapps/readmodels';
import { backup } from '@lazyapps/readmodelstorage-mongodb/backup.js';
import { start } from '@lazyapps/bootstrap';
import { filesystemTimestampStorage } from '@lazyapps/readmodels/secondaryTimestampStorage.js';
import * as readModels from './readmodels/index.js';
import { commandSenderFetch } from '@lazyapps/command-sender-fetch';
import { customizeExpress as customizeExpressGraphql } from './graphql-server.js';

const expressPort = process.env.EXPRESS_PORT || 3005;
const developmentMode = process.env.DEVELOPMENT_MODE === 'true';
const secondaryTsPath = process.env.SECONDARY_TS_PATH || './secondary-timestamps';

start({
  correlation: {
    serviceId: 'RM/ORD',
  },
  readModels: {
    listener: express({
      port: expressPort,
      customizeExpress: (context, app) => {
        customizeExpressGraphql(context, app);
        installReadModelStatusApi(context)(app);
        installAdminEndpoints(context, app);
      },
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
    commandSender: commandSenderFetch({ url: process.env.COMMAND_URL }),
    backup: backup({
      backupPath: process.env.BACKUP_PATH || './backup',
    }),
    lifecycle: true,
    endpointName: 'orders',
    developmentMode,
    secondaryTimestampStorage: filesystemTimestampStorage(secondaryTsPath),
    readModels,
  },
});
