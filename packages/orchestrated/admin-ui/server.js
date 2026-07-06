import { start } from '@lazyapps/bootstrap';
import { rabbitMq } from '@lazyapps/eventbus-rabbitmq/command-receiver/index.js';

const rabbitUrl = process.env.RABBIT_URL || 'amqp://localhost';
const adminPort = process.env.PORT || 3000;
const developmentMode = process.env.DEVELOPMENT_MODE === 'true';
// Idle grace before on-demand SSE subscriptions are torn down (ms)
const sseIdleGraceMs = process.env.SSE_IDLE_GRACE_MS
  ? Number(process.env.SSE_IDLE_GRACE_MS)
  : undefined;
const readModelServiceUrl = process.env.ADMIN_READ_MODEL_SERVICES
  ? JSON.parse(process.env.ADMIN_READ_MODEL_SERVICES)
  : undefined;
const commandProcessorUrl = process.env.ADMIN_COMMAND_PROCESSOR_URL || 'http://command-processor:3001';

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
    commandProcessorUrl,
    autoActivate: true,
    developmentMode,
    sseIdleGraceMs,
  },
});
