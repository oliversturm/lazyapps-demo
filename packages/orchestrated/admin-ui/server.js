import { start } from '@lazyapps/bootstrap';
import { rabbitMq } from '@lazyapps/eventbus-rabbitmq/command-receiver/index.js';

const rabbitUrl = process.env.RABBIT_URL || 'amqp://localhost';
const adminPort = process.env.PORT || 3000;
const readModelServiceUrl = process.env.ADMIN_READ_MODEL_SERVICES
  ? JSON.parse(process.env.ADMIN_READ_MODEL_SERVICES)
  : undefined;

start({
  correlation: {
    serviceId: 'ADMIN',
  },
  admin: {
    port: adminPort,
    eventBus: rabbitMq({
      url: rabbitUrl,
      topic: 'events',
    }),
    readModelServiceUrl,
    autoActivate: true,
  },
});
