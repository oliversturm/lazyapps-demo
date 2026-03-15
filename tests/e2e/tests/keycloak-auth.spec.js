import { test, expect } from '@playwright/test';
import { keycloakLogin, navigate } from './helpers/app.js';

// Keycloak test users from realm-export.json
const USERS = {
  alice: {
    username: 'alice',
    password: 'alice',
    roles: ['admin', 'customer-service'],
    sub: 'a1b2c3d4-e5f6-7890-abcd-ef1234567001',
  },
  bob: {
    username: 'bob',
    password: 'bob',
    roles: ['support'],
    sub: 'a1b2c3d4-e5f6-7890-abcd-ef1234567002',
  },
  carol: {
    username: 'carol',
    password: 'carol',
    roles: ['customer-service'],
    sub: 'a1b2c3d4-e5f6-7890-abcd-ef1234567003',
  },
  dave: {
    username: 'dave',
    password: 'dave',
    roles: [],
    sub: 'a1b2c3d4-e5f6-7890-abcd-ef1234567004',
  },
};

/**
 * Create a customer using the "New Customer" button.
 * In the orchestrated app, the aggregateId defaults to getUserId() (the
 * Keycloak sub), so each user creates "their own" customer record.
 */
const createCustomerAsUser = async (page, { name, location }) => {
  await navigate(page, 'Customers');
  await page.getByText('New Customer').waitFor();
  await page.getByText('New Customer').click();
  await page.waitForLoadState('networkidle');
  await page.locator('input[name="name"]').waitFor({ timeout: 1000 });
  await page.locator('input[name="name"]').fill(name);
  await page.locator('input[name="location"]').fill(location);
  await page.getByText('Save').click();
  // Wait for CQRS pipeline
  await page.getByText(name).first().waitFor({ timeout: 1000 });
};

test.describe('Keycloak authentication and role-based access', () => {
  // --- Login tests ---

  test.describe('user login', () => {
    for (const [name, user] of Object.entries(USERS)) {
      test(`${name} can log in via Keycloak`, async ({ browser, baseURL }) => {
        const context = await browser.newContext();
        const page = await context.newPage();

        try {
          await keycloakLogin(page, baseURL, user.username, user.password);

          // Verify username is displayed in the nav bar
          await expect(
            page.locator('.bg-orange-100').getByText(user.username),
          ).toBeVisible({ timeout: 1000 });

          // Verify the app loaded (Customers nav link is visible)
          await expect(
            page
              .locator('.bg-orange-100')
              .getByRole('link', { name: 'Customers' })
              .or(
                page
                  .locator('.bg-orange-100')
                  .getByRole('button', { name: 'Customers' }),
              ),
          ).toBeVisible();
        } finally {
          await context.close();
        }
      });
    }
  });

  // --- Role-based query visibility ---

  test.describe('role-based PII visibility', () => {
    // This test creates a customer as alice (admin) and then verifies
    // that different users see different things when querying.
    // All customer fields (name, location) are encrypted under the
    // 'personal' context whose roles include:
    //   admin, support, self, customer-service, order-service
    //
    // alice (admin, customer-service): sees PII ✓
    // bob (support): sees PII ✓
    // carol (customer-service): sees PII ✓
    // dave (no roles): sees [restricted] for alice's customer

    test('alice creates a customer visible to authorized users', async ({
      browser,
      baseURL,
    }) => {
      const unique = `${Date.now()}`;
      const customerName = `AuthTest-${unique}`;

      // Alice creates the customer
      const aliceCtx = await browser.newContext();
      const alicePage = await aliceCtx.newPage();

      try {
        await keycloakLogin(
          alicePage,
          baseURL,
          USERS.alice.username,
          USERS.alice.password,
        );
        await createCustomerAsUser(alicePage, {
          name: customerName,
          location: 'AuthCity',
        });

        // Alice (admin) should see PII in plaintext
        await navigate(alicePage, 'Customers');
        await expect(alicePage.getByText(customerName).first()).toBeVisible({
          timeout: 1000,
        });
      } finally {
        await aliceCtx.close();
      }

      // Bob (support) should also see PII
      const bobCtx = await browser.newContext();
      const bobPage = await bobCtx.newPage();

      try {
        await keycloakLogin(
          bobPage,
          baseURL,
          USERS.bob.username,
          USERS.bob.password,
        );
        await navigate(bobPage, 'Customers');
        await expect(bobPage.getByText(customerName).first()).toBeVisible({
          timeout: 1000,
        });
      } finally {
        await bobCtx.close();
      }

      // Carol (customer-service) should also see PII
      const carolCtx = await browser.newContext();
      const carolPage = await carolCtx.newPage();

      try {
        await keycloakLogin(
          carolPage,
          baseURL,
          USERS.carol.username,
          USERS.carol.password,
        );
        await navigate(carolPage, 'Customers');
        await expect(carolPage.getByText(customerName).first()).toBeVisible({
          timeout: 1000,
        });
      } finally {
        await carolCtx.close();
      }

      // Dave (no roles) should see [restricted] for alice's customer
      const daveCtx = await browser.newContext();
      const davePage = await daveCtx.newPage();

      try {
        await keycloakLogin(
          davePage,
          baseURL,
          USERS.dave.username,
          USERS.dave.password,
        );
        await navigate(davePage, 'Customers');
        // Dave should NOT see the plaintext customer name
        await davePage.waitForTimeout(3000); // Allow read model to load
        await expect(davePage.getByText(customerName).first()).toBeHidden({
          timeout: 1000,
        });
        // Instead, dave should see [restricted] for the encrypted fields
        await expect(davePage.getByText('[restricted]').first()).toBeVisible({
          timeout: 1000,
        });
      } finally {
        await daveCtx.close();
      }
    });
  });

  // --- Self-access pattern ---

  test.describe('self-access', () => {
    test('dave can see his own customer data via self-access', async ({
      browser,
      baseURL,
    }) => {
      const unique = `${Date.now()}`;
      const daveName = `DaveSelf-${unique}`;

      // Dave creates a customer — the aggregateId will be his Keycloak sub
      const daveCtx = await browser.newContext();
      const davePage = await daveCtx.newPage();

      try {
        await keycloakLogin(
          davePage,
          baseURL,
          USERS.dave.username,
          USERS.dave.password,
        );

        await createCustomerAsUser(davePage, {
          name: daveName,
          location: 'DaveCity',
        });

        // Dave should see his own customer data (self-access grants 'self' role
        // which is in the personal context's role list)
        await navigate(davePage, 'Customers');
        await expect(davePage.getByText(daveName).first()).toBeVisible({
          timeout: 1000,
        });
      } finally {
        await daveCtx.close();
      }

      // Alice should also see dave's customer (she has admin role)
      const aliceCtx = await browser.newContext();
      const alicePage = await aliceCtx.newPage();

      try {
        await keycloakLogin(
          alicePage,
          baseURL,
          USERS.alice.username,
          USERS.alice.password,
        );
        await navigate(alicePage, 'Customers');
        await expect(alicePage.getByText(daveName).first()).toBeVisible({
          timeout: 1000,
        });
      } finally {
        await aliceCtx.close();
      }
    });

    test("dave sees [restricted] for other users' data but his own is visible", async ({
      browser,
      baseURL,
    }) => {
      const unique = `${Date.now()}`;
      const aliceName = `AliceData-${unique}`;
      const daveName = `DaveData-${unique}`;

      // Alice creates a customer
      const aliceCtx = await browser.newContext();
      const alicePage = await aliceCtx.newPage();

      try {
        await keycloakLogin(
          alicePage,
          baseURL,
          USERS.alice.username,
          USERS.alice.password,
        );
        await createCustomerAsUser(alicePage, {
          name: aliceName,
          location: 'AliceCity',
        });
      } finally {
        await aliceCtx.close();
      }

      // Dave creates his own customer, then checks visibility
      const daveCtx = await browser.newContext();
      const davePage = await daveCtx.newPage();

      try {
        await keycloakLogin(
          davePage,
          baseURL,
          USERS.dave.username,
          USERS.dave.password,
        );

        await createCustomerAsUser(davePage, {
          name: daveName,
          location: 'DaveCity',
        });

        // Navigate to Customers list
        await navigate(davePage, 'Customers');

        // Dave's own customer should be visible in plaintext
        await expect(davePage.getByText(daveName).first()).toBeVisible({
          timeout: 1000,
        });

        // Alice's customer name should NOT be visible to dave
        await expect(davePage.getByText(aliceName).first()).toBeHidden({
          timeout: 1000,
        });

        // There should be at least one [restricted] entry for alice's data
        await expect(davePage.getByText('[restricted]').first()).toBeVisible({
          timeout: 1000,
        });
      } finally {
        await daveCtx.close();
      }
    });
  });

  // --- Change notification redaction ---

  test.describe('change notification redaction', () => {
    test('authorized users see plaintext in real-time updates, dave sees [restricted]', async ({
      browser,
      baseURL,
    }) => {
      const unique = `${Date.now()}`;
      const customerName = `LiveUpdate-${unique}`;

      // Dave navigates to Customers first (to receive change notifications)
      const daveCtx = await browser.newContext();
      const davePage = await daveCtx.newPage();

      try {
        await keycloakLogin(
          davePage,
          baseURL,
          USERS.dave.username,
          USERS.dave.password,
        );
        await navigate(davePage, 'Customers');
        // Ensure route is compiled and socket.io connection established
        await davePage.getByText('New Customer').waitFor();
      } catch (err) {
        await daveCtx.close();
        throw err;
      }

      // Bob navigates to Customers (authorized, should see plaintext updates)
      const bobCtx = await browser.newContext();
      const bobPage = await bobCtx.newPage();

      try {
        await keycloakLogin(
          bobPage,
          baseURL,
          USERS.bob.username,
          USERS.bob.password,
        );
        await navigate(bobPage, 'Customers');
        await bobPage.getByText('New Customer').waitFor();
      } catch (err) {
        await bobCtx.close();
        await daveCtx.close();
        throw err;
      }

      // Alice creates a customer — both bob and dave should receive notifications
      const aliceCtx = await browser.newContext();
      const alicePage = await aliceCtx.newPage();

      try {
        await keycloakLogin(
          alicePage,
          baseURL,
          USERS.alice.username,
          USERS.alice.password,
        );
        await createCustomerAsUser(alicePage, {
          name: customerName,
          location: 'LiveCity',
        });
      } finally {
        await aliceCtx.close();
      }

      try {
        // Bob (support) should see the customer name in plaintext via notification
        await expect(bobPage.getByText(customerName).first()).toBeVisible({
          timeout: 1000,
        });

        // Dave (no roles) should NOT see the customer name — should see [restricted]
        // Wait for the change notification to arrive
        await davePage.waitForTimeout(3000);
        await expect(davePage.getByText(customerName).first()).toBeHidden({
          timeout: 1000,
        });
      } finally {
        await bobCtx.close();
        await daveCtx.close();
      }
    });
  });
});
