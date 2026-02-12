import { initialize } from '@lazyapps/observability';
import { configureOtel } from '@lazyapps/logger';
import { trace, context } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';

initialize({
  serviceName: 'lazyapps-monolith',
  otlp: {
    endpoint:
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4317',
  },
});

configureOtel({ logs, SeverityNumber, trace, context });
