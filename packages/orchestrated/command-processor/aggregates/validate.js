import { AuthorizationError } from '@lazyapps/command-processor/validation.js';

export const exists = (agg) => {
  if (!agg.creationTimestamp) throw new Error(`The aggregate doesn't exist`);
};

export const doesntExist = (agg) => {
  if (agg.creationTimestamp) throw new Error(`The aggregate exists already`);
};

export const has = (ob, field) => {
  if (!ob[field])
    throw new Error(
      `The object doesn't include the required field '${field}', or its value is empty`,
    );
};

export const isForgotten = (value) =>
  value && typeof value === 'object' && value.forgotten === true;

export const notForgotten = (agg, ...fields) => {
  for (const field of fields) {
    if (isForgotten(agg[field])) {
      const err = new Error(
        `Cannot modify aggregate: field '${field}' has been forgotten`,
      );
      err.name = 'ValidationError';
      throw err;
    }
  }
};

export const is = (ob, field, value) => {
  if (ob[field] !== value)
    throw new Error(
      `The object's field '${field}' has an unexpected value '${ob[field]}' (expected '${value}')`,
    );
};

export const oneOf = (ob, field, values) => {
  if (!values.find((v) => v === ob[field]))
    throw new Error(
      `The object's field '${field}' has an unexpected value '${
        ob[field]
      }' (expected one of [${values.map((v) => `'${v}'`).join(', ')}])`,
    );
};

export const hasRole = (auth, role) =>
  auth &&
  auth.realm_access &&
  auth.realm_access.roles &&
  auth.realm_access.roles.includes(role);

export const isAdmin = (auth) => hasRole(auth, 'admin');

export const requireAdmin = (auth) => {
  if (!isAdmin(auth))
    throw new AuthorizationError('Admin role required');
};

export const requireRole = (auth, ...roles) => {
  if (!roles.some((role) => hasRole(auth, role)))
    throw new AuthorizationError(
      `One of the following roles is required: ${roles.join(', ')}`,
    );
};

export const requireOwnerOrAdmin = (auth, ownerId) => {
  if (!isAdmin(auth) && (!auth || auth.sub !== ownerId))
    throw new AuthorizationError(
      'You can only access your own resources, or you need admin role',
    );
};
