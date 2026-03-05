import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { buildSchema, graphql } from 'graphql';
import { createHandler } from 'graphql-http/lib/use/express';

const schemaSource = readFileSync('schema.graphql', 'utf-8');

describe('GraphQL schema', () => {
  it('loads and builds the schema from schema.graphql', () => {
    const schema = buildSchema(schemaSource);
    expect(schema).toBeDefined();
    expect(schema.getQueryType()).toBeDefined();
  });

  it('defines expected query fields', () => {
    const schema = buildSchema(schemaSource);
    const queryType = schema.getQueryType();
    const fields = queryType.getFields();
    expect(fields).toHaveProperty('orders');
    expect(fields).toHaveProperty('order');
    expect(fields).toHaveProperty('customers');
    expect(fields).toHaveProperty('customer');
  });

  it('defines Order type with expected fields', () => {
    const schema = buildSchema(schemaSource);
    const orderType = schema.getType('Order');
    expect(orderType).toBeDefined();
    const fields = orderType.getFields();
    expect(fields).toHaveProperty('id');
    expect(fields).toHaveProperty('text');
    expect(fields).toHaveProperty('value');
    expect(fields).toHaveProperty('usdValue');
    expect(fields).toHaveProperty('usdRate');
  });

  it('defines Customer type with expected fields', () => {
    const schema = buildSchema(schemaSource);
    const customerType = schema.getType('Customer');
    expect(customerType).toBeDefined();
    const fields = customerType.getFields();
    expect(fields).toHaveProperty('id');
    expect(fields).toHaveProperty('name');
    expect(fields).toHaveProperty('orders');
  });
});

describe('GraphQL handler', () => {
  it('creates an express handler with the schema', () => {
    const schema = buildSchema(schemaSource);
    const handler = createHandler({
      schema,
      rootValue: {},
    });
    expect(handler).toBeDefined();
    expect(typeof handler).toBe('function');
  });
});

describe('GraphQL query execution', () => {
  it('executes an orders query with root resolver', () => {
    const schema = buildSchema(schemaSource);
    const rootValue = {
      orders: () => [
        { id: '1', text: 'Test order', value: 99.99, usdValue: 109.5, usdRate: '1.095' },
      ],
    };

    return graphql({ schema, source: '{ orders { id text value usdValue usdRate } }', rootValue })
      .then((result) => {
        expect(result.errors).toBeUndefined();
        expect(result.data.orders).toHaveLength(1);
        expect(result.data.orders[0]).toEqual({
          id: '1',
          text: 'Test order',
          value: 99.99,
          usdValue: 109.5,
          usdRate: '1.095',
        });
      });
  });

  it('executes a single order query with id argument', () => {
    const schema = buildSchema(schemaSource);
    const rootValue = {
      order: ({ id }) => ({ id, text: 'Found order', value: 50.0, usdValue: null, usdRate: null }),
    };

    return graphql({ schema, source: '{ order(id: "42") { id text value } }', rootValue })
      .then((result) => {
        expect(result.errors).toBeUndefined();
        expect(result.data.order.id).toBe('42');
        expect(result.data.order.text).toBe('Found order');
      });
  });

  it('executes a customers query with nested orders', () => {
    const schema = buildSchema(schemaSource);
    const rootValue = {
      customers: () => [
        {
          id: 'c1',
          name: 'Alice',
          orders: () => [
            { id: 'o1', text: 'Widget', value: 25.0, usdValue: 27.5, usdRate: '1.1' },
          ],
        },
      ],
    };

    return graphql({
      schema,
      source: '{ customers { id name orders { id text value } } }',
      rootValue,
    }).then((result) => {
      expect(result.errors).toBeUndefined();
      expect(result.data.customers).toHaveLength(1);
      expect(result.data.customers[0].name).toBe('Alice');
      expect(result.data.customers[0].orders).toHaveLength(1);
      expect(result.data.customers[0].orders[0].id).toBe('o1');
    });
  });
});
