import { initialize, getLoggerProvider } from '@lazyapps/observability';
import { configureOtel } from '@lazyapps/logger';
import { trace, context } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';

initialize({
  serviceName: process.env.OTEL_SERVICE_NAME || 'change-notifier',
  otlp: {
    endpoint:
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4317',
    protocol: process.env.OTEL_EXPORTER_OTLP_PROTOCOL || 'grpc',
  },
});

configureOtel({
  logs,
  SeverityNumber,
  trace,
  context,
  loggerProvider: getLoggerProvider(),
});
