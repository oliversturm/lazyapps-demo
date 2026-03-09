import { test, expect } from '@playwright/test';

// Direct Vault API access (not through Traefik — Vault is internal infrastructure)
const VAULT_ADDR = 'http://vault:8200';

const SERVICES = [
  {
    name: 'command-processor',
    roleId: 'command-processor-role-id',
    secretId: 'command-processor-secret-id',
  },
  {
    name: 'readmodel-customers',
    roleId: 'readmodel-customers-role-id',
    secretId: 'readmodel-customers-secret-id',
  },
  {
    name: 'readmodel-orders',
    roleId: 'readmodel-orders-role-id',
    secretId: 'readmodel-orders-secret-id',
  },
];

test.describe('Vault AppRole authentication', () => {
  test('transit secrets engine is enabled', async ({ request }) => {
    const response = await request.get(`${VAULT_ADDR}/v1/sys/mounts`, {
      headers: { 'X-Vault-Token': 'dev-root-token' },
    });
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body['transit/']).toBeDefined();
    expect(body['transit/'].type).toBe('transit');
  });

  test('transit encryption keys exist', async ({ request }) => {
    for (const keyName of ['personal', 'order-details']) {
      const response = await request.get(
        `${VAULT_ADDR}/v1/transit/keys/${keyName}`,
        { headers: { 'X-Vault-Token': 'dev-root-token' } },
      );
      expect(
        response.ok(),
        `Transit key '${keyName}' should exist`,
      ).toBeTruthy();
    }
  });

  for (const { name, roleId, secretId } of SERVICES) {
    test(`${name} can authenticate via AppRole`, async ({ request }) => {
      const response = await request.post(
        `${VAULT_ADDR}/v1/auth/approle/login`,
        {
          data: { role_id: roleId, secret_id: secretId },
        },
      );
      expect(
        response.ok(),
        `AppRole login for ${name} should succeed`,
      ).toBeTruthy();
      const body = await response.json();
      expect(body.auth).toBeDefined();
      expect(body.auth.client_token).toBeTruthy();
    });
  }

  test('command-processor token can encrypt with transit', async ({
    request,
  }) => {
    // Login as command-processor
    const loginRes = await request.post(
      `${VAULT_ADDR}/v1/auth/approle/login`,
      {
        data: {
          role_id: 'command-processor-role-id',
          secret_id: 'command-processor-secret-id',
        },
      },
    );
    const { auth } = await loginRes.json();

    // Encrypt a test value using the personal transit key
    const encryptRes = await request.post(
      `${VAULT_ADDR}/v1/transit/encrypt/personal`,
      {
        headers: { 'X-Vault-Token': auth.client_token },
        data: { plaintext: Buffer.from('test-data').toString('base64') },
      },
    );
    expect(encryptRes.ok()).toBeTruthy();
    const encryptBody = await encryptRes.json();
    expect(encryptBody.data.ciphertext).toMatch(/^vault:v1:/);

    // Decrypt it back
    const decryptRes = await request.post(
      `${VAULT_ADDR}/v1/transit/decrypt/personal`,
      {
        headers: { 'X-Vault-Token': auth.client_token },
        data: { ciphertext: encryptBody.data.ciphertext },
      },
    );
    expect(decryptRes.ok()).toBeTruthy();
    const decryptBody = await decryptRes.json();
    const plaintext = Buffer.from(
      decryptBody.data.plaintext,
      'base64',
    ).toString();
    expect(plaintext).toBe('test-data');
  });

  test('readmodel-customers token can encrypt and decrypt (envelope encryption)', async ({
    request,
  }) => {
    const loginRes = await request.post(
      `${VAULT_ADDR}/v1/auth/approle/login`,
      {
        data: {
          role_id: 'readmodel-customers-role-id',
          secret_id: 'readmodel-customers-secret-id',
        },
      },
    );
    const { auth } = await loginRes.json();

    // Readmodels need encrypt+decrypt for envelope encryption (wrapping/unwrapping DEKs)
    const encryptRes = await request.post(
      `${VAULT_ADDR}/v1/transit/encrypt/personal`,
      {
        headers: { 'X-Vault-Token': auth.client_token },
        data: { plaintext: Buffer.from('test').toString('base64') },
      },
    );
    expect(encryptRes.ok()).toBeTruthy();

    const { data } = await encryptRes.json();
    const decryptRes = await request.post(
      `${VAULT_ADDR}/v1/transit/decrypt/personal`,
      {
        headers: { 'X-Vault-Token': auth.client_token },
        data: { ciphertext: data.ciphertext },
      },
    );
    expect(decryptRes.ok()).toBeTruthy();
  });
});
