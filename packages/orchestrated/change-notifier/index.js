import { start } from '@lazyapps/bootstrap';
import { express } from '@lazyapps/change-notifier-socket-io';
import {
  encryptionSchema,
  encryptionContexts,
} from '../common/encryption-config.js';
import { jwtSecret, jwtAlgorithms, jwksUri } from '../common/jwt-config.js';

const keycloakScopeMapper = (decodedToken) => {
  if (!decodedToken) return [];
  const roles =
    (decodedToken.realm_access && decodedToken.realm_access.roles) || [];
  return [...roles].sort();
};

// Fields that require personal-context access, keyed by the changeInfo
// field name inside `details`. When a user's scopes don't include any
// of the personal-context roles, these fields are replaced with a
// structured placeholder so the frontend renders [restricted].
const personalRoles = new Set(encryptionContexts.personal.roles);
const personalFields = ['name', 'customerName'];

const redactDetails = (payload, scopes) => {
  if (!payload.details) return payload;
  const hasAccess = scopes.some((s) => personalRoles.has(s));
  if (hasAccess) return payload;

  const details = { ...payload.details };
  let changed = false;
  for (const field of personalFields) {
    if (details[field] !== undefined) {
      details[field] = { restricted: true, text: '[restricted]' };
      changed = true;
    }
  }
  return changed ? { ...payload, details } : payload;
};

// Register the same hook for every readModelName that may carry PII
// in its change notification details.
const redactionHooks = {
  overview: redactDetails,
  confirmationRequests: redactDetails,
  editing: redactDetails,
};

start({
  correlation: {
    serviceId: 'CHNG',
  },
  changeNotifier: {
    listener: express({
      port: process.env.EXPRESS_PORT || 3008,
      jwtSecret,
      jwtAlgorithms,
      jwksUri,
      scopeMapper: keycloakScopeMapper,
      encryptionSchema,
      encryptionContexts,
      redactionHooks,
    }),
  },
});
