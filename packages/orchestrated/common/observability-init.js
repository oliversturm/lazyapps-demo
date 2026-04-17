import { initialize, getLoggerProvider } from '@lazyapps/observability';
import { configureOtel } from '@lazyapps/logger';
import { trace, context } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';

initialize({
  // DEV ONLY — production must use TLS endpoints (https://, wss://)
  // and remove this.
  otlp: { insecure: true },
});

configureOtel({
  logs,
  SeverityNumber,
  trace,
  context,
  loggerProvider: getLoggerProvider(),
});
