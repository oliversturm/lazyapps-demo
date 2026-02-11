import { start } from '@lazyapps/bootstrap';
import { express } from '@lazyapps/change-notifier-socket-io';

start({
  observability: {
    serviceName: process.env.OTEL_SERVICE_NAME || 'change-notifier',
    otlp: {
      endpoint:
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4317',
      protocol: process.env.OTEL_EXPORTER_OTLP_PROTOCOL || 'grpc',
    },
  },
  correlation: {
    serviceId: 'CHNG',
  },
  changeNotifier: {
    listener: express({ port: process.env.EXPRESS_PORT || 3008 }),
  },
});
