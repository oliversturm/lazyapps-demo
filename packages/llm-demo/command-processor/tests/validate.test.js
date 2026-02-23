import { describe, test, expect } from 'vitest';
import { exists, doesntExist, has, is, oneOf } from '../aggregates/validate.js';

describe('has', () => {
  test('passes when field is present with string value', () => {
    expect(() => has({ name: 'Alice' }, 'name')).not.toThrow();
  });

  test('passes when field is false (boolean)', () => {
    expect(() => has({ failSafe: false }, 'failSafe')).not.toThrow();
  });

  test('passes when field is 0 (number)', () => {
    expect(() => has({ orderValue: 0 }, 'orderValue')).not.toThrow();
  });

  test('passes when field is empty string', () => {
    expect(() => has({ text: '' }, 'text')).not.toThrow();
  });

  test('throws when field is undefined', () => {
    expect(() => has({}, 'name')).toThrow(
      "required field 'name'",
    );
  });

  test('throws when field is null', () => {
    expect(() => has({ name: null }, 'name')).toThrow(
      "required field 'name'",
    );
  });

  test('throws when field is explicitly undefined', () => {
    expect(() => has({ name: undefined }, 'name')).toThrow(
      "required field 'name'",
    );
  });
});

describe('exists', () => {
  test('passes when aggregate has creationTimestamp', () => {
    expect(() => exists({ creationTimestamp: 1000 })).not.toThrow();
  });

  test('throws when aggregate has no creationTimestamp', () => {
    expect(() => exists({})).toThrow("The aggregate doesn't exist");
  });
});

describe('doesntExist', () => {
  test('passes when aggregate has no creationTimestamp', () => {
    expect(() => doesntExist({})).not.toThrow();
  });

  test('throws when aggregate has creationTimestamp', () => {
    expect(() => doesntExist({ creationTimestamp: 1000 })).toThrow(
      'The aggregate exists already',
    );
  });
});

describe('is', () => {
  test('passes when field matches value', () => {
    expect(() => is({ status: 'active' }, 'status', 'active')).not.toThrow();
  });

  test('throws when field does not match', () => {
    expect(() => is({ status: 'active' }, 'status', 'inactive')).toThrow(
      "unexpected value 'active'",
    );
  });
});

describe('oneOf', () => {
  test('passes when field is one of the values', () => {
    expect(() =>
      oneOf({ rep: 'good' }, 'rep', ['good', 'neutral', 'poor']),
    ).not.toThrow();
  });

  test('throws when field is not one of the values', () => {
    expect(() =>
      oneOf({ rep: 'bad' }, 'rep', ['good', 'neutral', 'poor']),
    ).toThrow("unexpected value 'bad'");
  });
});
