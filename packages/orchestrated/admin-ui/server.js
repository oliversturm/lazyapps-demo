import { start } from '@lazyapps/bootstrap';
import { mongodb as eventStoreMongo } from '@lazyapps/eventstore-mongodb';
import { mongodb as readModelStorageMongo } from '@lazyapps/readmodelstorage-mongodb';
import { backup } from '@lazyapps/readmodelstorage-mongodb/backup.js';
import { rabbitMq } from '@lazyapps/eventbus-rabbitmq/command-receiver/index.js';

const mongoUrl = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017';
const rabbitUrl = process.env.RABBIT_URL || 'amqp://localhost';
const adminPort = process.env.PORT || 3000;
const backupPath = process.env.BACKUP_PATH || '/tmp/lazyapps-backups';

// Read model stubs — the admin service needs names and collection info
// but not the full projection/resolver code (those run in the RM services).
const readModels = {
  overview: { collections: ['overview'] },
  editing: { collections: ['editing'] },
  orders: { collections: ['orders'] },
};

start({
  correlation: {
    serviceId: 'ADMIN',
  },
  admin: {
    port: adminPort,
    eventStore: eventStoreMongo({ url: mongoUrl }),
    readModelStorage: readModelStorageMongo({
      url: mongoUrl,
      database: 'admin-readmodels',
    }),
    eventBus: rabbitMq({
      url: rabbitUrl,
      topic: 'events',
    }),
    backup: backup({ backupPath }),
    readModels,
    autoActivate: true,
  },
});
