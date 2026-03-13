import { expressJwtSecret } from 'jwks-rsa';

export const jwksUri =
  process.env.JWKS_URI ||
  'http://keycloak:8080/realms/lazyapps-demo/protocol/openid-connect/certs';

export const jwtSecret = expressJwtSecret({
  cache: true,
  rateLimit: true,
  jwksRequestsPerMinute: 10,
  jwksUri,
});

export const jwtAlgorithms = ['RS256'];
