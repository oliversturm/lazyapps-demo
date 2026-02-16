import { initialize, getLoggerProvider } from '@lazyapps/observability';
import { configureOtel } from '@lazyapps/logger';
import { trace, context } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';

initialize({
  httpInstrumentation: {
    ignoreIncomingRequestHook: (request) => {
      const url = request.url || '';
      return (
        url.startsWith('/@') ||
        url.startsWith('/node_modules/') ||
        url.startsWith('/src/') ||
        url.endsWith('.svelte') ||
        url.includes('__vite') ||
        url.endsWith('.js') ||
        url.startsWith('/socket.io/')
      );
    },
  },
});

configureOtel({
  logs,
  SeverityNumber,
  trace,
  context,
  loggerProvider: getLoggerProvider(),
});
