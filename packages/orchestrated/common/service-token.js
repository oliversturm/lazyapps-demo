import * as client from 'openid-client';
import { getLogger } from '@lazyapps/logger';

/**
 * Create a cached service account token provider using openid-client
 * and Keycloak client credentials grant. Returns a function that
 * resolves to a fresh (or cached) access token string.
 */
export const createServiceTokenProvider = ({
  label = 'SVC/JWT',
  issuerUrl = process.env.KEYCLOAK_ISSUER_URL ||
    'http://keycloak:8080/realms/lazyapps-demo',
  clientId = process.env.SERVICE_CLIENT_ID || 'lazyapps-service',
  clientSecret = process.env.SERVICE_CLIENT_SECRET || 'service-account-secret',
} = {}) => {
  const log = getLogger(label, 'INIT');
  let cached = null;
  let expiresAt = 0;
  let configPromise = null;

  const getConfig = () => {
    if (!configPromise) {
      configPromise = client
        .discovery(new URL(issuerUrl), clientId, clientSecret, undefined, {
          execute: [client.allowInsecureRequests],
        })
        .then((config) => {
          log.info('OpenID Connect discovery completed');
          return config;
        });
    }
    return configPromise;
  };

  return () => {
    if (cached && Date.now() < expiresAt) return Promise.resolve(cached);
    return getConfig()
      .then((config) => client.clientCredentialsGrant(config))
      .then((tokens) => {
        cached = tokens.access_token;
        // Refresh 30 seconds before expiry
        expiresAt = Date.now() + (tokens.expires_in - 30) * 1000;
        log.info('Service account token acquired');
        return cached;
      });
  };
};
