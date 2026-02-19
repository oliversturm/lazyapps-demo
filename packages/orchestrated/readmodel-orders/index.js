import { express } from '@lazyapps/express/readmodels/index.js';
import { mongodb } from '@lazyapps/readmodelstorage-mongodb';
import { rabbitMq } from '@lazyapps/eventbus-rabbitmq/readmodels/index.js';
import { changeNotificationSenderFetch } from '@lazyapps/change-notification-sender-fetch';
import { installReadModelAdminApi } from '@lazyapps/admin-api';
import { mongoBackup } from '@lazyapps/readmodel-backup-mongodb';
import { start } from '@lazyapps/bootstrap';
import * as readModels from './readmodels/index.js';
import { commandSenderFetch } from '@lazyapps/command-sender-fetch';
import { customizeExpress as customizeExpressGraphql } from './graphql-server.js';

start({
  correlation: {
    serviceId: 'RM/ORD',
  },
  readModels: {
    listener: express({
      port: process.env.EXPRESS_PORT || 3005,
      customizeExpress: (context, app) => {
        customizeExpressGraphql(context, app);
        installReadModelAdminApi(context)(app);
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
    backup: mongoBackup(),
    readModels,
  },
});
