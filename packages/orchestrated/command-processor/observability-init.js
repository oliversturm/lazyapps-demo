import { initialize } from '@lazyapps/observability';
import { configureOtel } from '@lazyapps/logger';

initialize({
  serviceName: process.env.OTEL_SERVICE_NAME || 'command-processor',
  otlp: {
    endpoint:
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4317',
    protocol: process.env.OTEL_EXPORTER_OTLP_PROTOCOL || 'grpc',
  },
});

configureOtel();
