import { start } from '@lazyapps/bootstrap';
import { express } from '@lazyapps/change-notifier-socket-io';
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
    }),
  },
});
