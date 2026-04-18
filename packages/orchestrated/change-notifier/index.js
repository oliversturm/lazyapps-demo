import { start } from '@lazyapps/bootstrap';
import { express } from '@lazyapps/change-notifier-socket-io';
import { rateLimit } from 'express-rate-limit';
import {
  encryptionSchema,
  encryptionContexts,
} from '../common/encryption-config.js';

const jwksUri =
  process.env.JWKS_URI ||
  'http://keycloak:8080/realms/lazyapps-demo/protocol/openid-connect/certs';

const keycloakScopeMapper = (decodedToken) => {
  if (!decodedToken) return [];
  const roles =
    (decodedToken.realm_access && decodedToken.realm_access.roles) || [];
  return [...roles].sort();
};

// Demo rate limiter: 100 requests per IP per minute.
const rateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

start({
  correlation: {
    serviceId: 'CHNG',
  },
  changeNotifier: {
    listener: express({
      port: process.env.EXPRESS_PORT || 3008,
      jwksUri,
      scopeMapper: keycloakScopeMapper,
      encryptionSchema,
      encryptionContexts,
      corsOrigin: ['http://svelte.localhost', 'http://react.localhost'],
      bodyLimit: '100kb',
      helmet: true,
      rateLimiter,
    }),
  },
});
