export const exists = (agg) => {
  if (!agg.creationTimestamp) throw new Error(`The aggregate doesn't exist`);
};

export const doesntExist = (agg) => {
  if (agg.creationTimestamp) throw new Error(`The aggregate exists already`);
};

export const has = (ob, field) => {
  if (ob[field] === undefined || ob[field] === null)
    throw new Error(
      `The object doesn't include the required field '${field}'`,
    );
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

export const isFiniteNumber = (ob, field) => {
  if (!Number.isFinite(ob[field]))
    throw new Error(
      `The object's field '${field}' must be a finite number`,
    );
};
