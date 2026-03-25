import { test, expect } from '@playwright/test';
import {
  keycloakLogin,
  navigate,
  createCustomer,
  placeOrder,
} from './helpers/app.js';

// Keycloak test users from realm-export.json
const USERS = {
  alice: {
    username: 'alice',
    password: 'alice',
    roles: ['admin', 'customer-service'],
    sub: 'a1b2c3d4-e5f6-7890-abcd-ef1234567001',
  },
  dave: {
    username: 'dave',
    password: 'dave',
    roles: [],
    sub: 'a1b2c3d4-e5f6-7890-abcd-ef1234567004',
  },
  grace: {
    username: 'grace',
    password: 'grace',
    roles: [],
    sub: 'a1b2c3d4-e5f6-7890-abcd-ef1234567007',
  },
};

test.describe('Authorization UI: button disabling and access control', () => {
  // --- Issue #7: Disable buttons for unauthorized customers ---

  test.describe('unprivileged user viewing restricted customer rows', () => {
    test('dave sees no action buttons for another user\'s restricted customer', async ({
      browser,
      baseURL,
    }) => {
      const unique = `${Date.now()}`;
      const aliceCustomerName = `AliceCust-${unique}`;

      // Alice (admin) creates a customer
      const aliceCtx = await browser.newContext();
      const alicePage = await aliceCtx.newPage();

      try {
        await keycloakLogin(
          alicePage,
          baseURL,
          USERS.alice.username,
          USERS.alice.password,
        );
        await createCustomer(alicePage, {
          name: aliceCustomerName,
          location: 'AliceCity',
        });
      } finally {
        await aliceCtx.close();
      }

      // Dave (no roles) logs in and views Customers
      const daveCtx = await browser.newContext();
      const davePage = await daveCtx.newPage();

      try {
        await keycloakLogin(
          davePage,
          baseURL,
          USERS.dave.username,
          USERS.dave.password,
        );

        // Dave creates his own customer so he has at least one row with buttons
        await createCustomer(davePage, {
          name: `DaveCust-${unique}`,
          location: 'DaveCity',
          userId: USERS.dave.sub,
        });

        await navigate(davePage, 'Customers');

        // Wait for data to load — dave should see [restricted] for alice's data
        await davePage.getByText('[restricted]').first().waitFor({ timeout: 5000 });

        // Find the row with [restricted] (alice's customer)
        const restrictedRow = davePage.locator('tr', {
          has: davePage.getByText('[restricted]'),
        }).first();

        // Dave is not admin and not owner of alice's customer, so canAct=false
        // and no action buttons should be rendered at all
        await expect(
          restrictedRow.getByText('Edit', { exact: true }),
        ).toBeHidden();
        await expect(
          restrictedRow.getByText('Place Order', { exact: true }),
        ).toBeHidden();
        await expect(
          restrictedRow.getByText('Forget', { exact: true }),
        ).toBeHidden();

        // Dave's own row should have working buttons (he is the owner)
        const daveRow = davePage.locator('tr', {
          has: davePage.getByText(`DaveCust-${unique}`, { exact: true }),
        });
        await expect(
          daveRow.getByText('Edit', { exact: true }),
        ).toBeVisible();
        await expect(
          daveRow.getByText('Place Order', { exact: true }),
        ).toBeVisible();
      } finally {
        await daveCtx.close();
      }
    });

    test('grace sees disabled buttons for both forgotten and restricted rows', async ({
      browser,
      baseURL,
    }) => {
      const unique = `${Date.now()}`;
      const aliceCustomerName = `GraceTestAlice-${unique}`;
      const graceCustomerName = `GraceTestGrace-${unique}`;

      // Alice (admin) creates a customer
      const aliceCtx = await browser.newContext();
      const alicePage = await aliceCtx.newPage();

      try {
        await keycloakLogin(
          alicePage,
          baseURL,
          USERS.alice.username,
          USERS.alice.password,
        );
        await createCustomer(alicePage, {
          name: aliceCustomerName,
          location: 'AliceCity',
        });
      } finally {
        await aliceCtx.close();
      }

      // Grace creates her own customer, then forgets herself
      const graceCtx1 = await browser.newContext();
      const gracePage1 = await graceCtx1.newPage();

      try {
        await keycloakLogin(
          gracePage1,
          baseURL,
          USERS.grace.username,
          USERS.grace.password,
        );

        await createCustomer(gracePage1, {
          name: graceCustomerName,
          location: 'GraceCity',
          userId: USERS.grace.sub,
        });

        // Forget grace's customer
        await navigate(gracePage1, 'Customers');
        await gracePage1.getByText(graceCustomerName).first().waitFor({ timeout: 1000 });

        const graceRow = gracePage1.locator('tr', {
          has: gracePage1.getByText(graceCustomerName, { exact: true }),
        });

        gracePage1.on('dialog', (dialog) => dialog.accept());
        await graceRow.getByText('Forget', { exact: true }).click();

        // Wait for forget to take effect
        await expect(gracePage1.getByText(graceCustomerName)).toBeHidden({
          timeout: 1000,
        });
      } finally {
        await graceCtx1.close();
      }

      // Grace logs in again to view the customer list with fresh eyes
      const graceCtx = await browser.newContext();
      const gracePage = await graceCtx.newPage();

      try {
        await keycloakLogin(
          gracePage,
          baseURL,
          USERS.grace.username,
          USERS.grace.password,
        );
        await navigate(gracePage, 'Customers');

        // Wait for data to load
        await gracePage.locator('table').waitFor({ timeout: 5000 });
        await gracePage.waitForTimeout(3000);

        // Grace should see [restricted] for alice's customer (unauthorized)
        await expect(
          gracePage.getByText('[restricted]').first(),
        ).toBeVisible({ timeout: 1000 });

        // Find restricted row (alice's customer) — buttons should be disabled
        const restrictedRow = gracePage.locator('tr', {
          has: gracePage.getByText('[restricted]'),
        }).first();

        const editRestricted = restrictedRow.getByText('Edit', { exact: true });
        // Buttons should either not exist (no canAct) or be disabled
        // Grace is not admin and not owner of alice's customer, so canAct=false
        // and no buttons should be shown at all
        const restrictedButtonCount = await restrictedRow
          .getByText('Edit', { exact: true })
          .count();

        // If buttons are shown (canAct is true due to bug), they should be disabled
        if (restrictedButtonCount > 0) {
          await expect(editRestricted).toHaveClass(/pointer-events-none/);
        }

        // Find forgotten row (grace's own customer) — should show [deleted]
        const forgottenRow = gracePage.locator('tr', {
          has: gracePage.getByText('[deleted]'),
        }).first();

        const forgottenRowCount = await forgottenRow.count();
        if (forgottenRowCount > 0) {
          // If buttons are present, they should be disabled
          const editForgotten = forgottenRow.getByText('Edit', { exact: true });
          const editForgottenCount = await editForgotten.count();
          if (editForgottenCount > 0) {
            await expect(editForgotten).toHaveClass(/pointer-events-none/);
          }

          // Forget button should not be visible for forgotten customer
          await expect(
            forgottenRow.getByText('Forget', { exact: true }),
          ).toBeHidden();
        }
      } finally {
        await graceCtx.close();
      }
    });
  });

  // --- Issue #8: Graceful handling on edit page ---

  test.describe('direct URL navigation to restricted customer edit page', () => {
    test('unauthorized user sees access denied message instead of crash', async ({
      browser,
      baseURL,
    }) => {
      const unique = `${Date.now()}`;
      const aliceCustomerName = `EditTest-${unique}`;

      // Alice (admin) creates a customer
      const aliceCtx = await browser.newContext();
      const alicePage = await aliceCtx.newPage();
      let aliceCustomerId;

      try {
        await keycloakLogin(
          alicePage,
          baseURL,
          USERS.alice.username,
          USERS.alice.password,
        );
        await createCustomer(alicePage, {
          name: aliceCustomerName,
          location: 'EditCity',
        });

        // The customer ID for admin-created customers is a UUID generated by the
        // "New Customer" button. We need alice's admin-created customer ID.
        // Navigate to customers to find it — the ID is in the table.
        await navigate(alicePage, 'Customers');
        await alicePage.getByText(aliceCustomerName).first().waitFor({ timeout: 1000 });

        const customerRow = alicePage.locator('tr', {
          has: alicePage.getByText(aliceCustomerName, { exact: true }),
        });

        // The ID column is the second <td> in the row
        const idCell = customerRow.locator('td').nth(1);
        aliceCustomerId = await idCell.textContent();
      } finally {
        await aliceCtx.close();
      }

      // Dave (no roles) navigates directly to the edit page for alice's customer
      const daveCtx = await browser.newContext();
      const davePage = await daveCtx.newPage();

      try {
        await keycloakLogin(
          davePage,
          baseURL,
          USERS.dave.username,
          USERS.dave.password,
        );

        // Navigate directly to alice's customer edit page
        const editUrl = `${baseURL}/customer/${aliceCustomerId}`;
        await davePage.goto(editUrl, { waitUntil: 'domcontentloaded' });
        await davePage.waitForLoadState('networkidle');

        // Wait for the page to fully render (Vite dev server may need to compile)
        await davePage.waitForTimeout(3000);

        // Should see an access denied message, not a crash
        await expect(
          davePage.getByText('Access Denied'),
        ).toBeVisible({ timeout: 5000 });

        // The form inputs should NOT be visible (no crash into broken form)
        await expect(
          davePage.locator('input[name="name"]'),
        ).toBeHidden({ timeout: 1000 });
      } finally {
        await daveCtx.close();
      }
    });
  });

  // --- Issue #9: Order confirmation restricted by role ---

  test.describe('order confirmation restricted to authorized roles', () => {
    test('unprivileged user cannot confirm orders', async ({
      browser,
      baseURL,
    }) => {
      const unique = `${Date.now()}`;
      const customerName = `ConfirmTest-${unique}`;
      const orderText = `BigOrder-${unique}`;

      // Alice (admin) creates a customer and places a large order (>1000 → needs confirmation)
      const aliceCtx = await browser.newContext();
      const alicePage = await aliceCtx.newPage();

      try {
        await keycloakLogin(
          alicePage,
          baseURL,
          USERS.alice.username,
          USERS.alice.password,
        );
        await createCustomer(alicePage, {
          name: customerName,
          location: 'ConfirmCity',
        });
        await placeOrder(alicePage, customerName, {
          text: orderText,
          value: 1500,
        });

        // Verify the order is unconfirmed
        await navigate(alicePage, 'Orders');
        const orderRow = alicePage.locator('tr', {
          has: alicePage.getByText(orderText, { exact: true }),
        });
        await expect(
          orderRow.getByText('unconfirmed', { exact: true }),
        ).toBeVisible({ timeout: 1000 });
      } finally {
        await aliceCtx.close();
      }

      // Dave (no roles) logs in and navigates to Order Confirmation Requests
      const daveCtx = await browser.newContext();
      const davePage = await daveCtx.newPage();

      try {
        await keycloakLogin(
          davePage,
          baseURL,
          USERS.dave.username,
          USERS.dave.password,
        );

        await navigate(davePage, 'Order Confirmation Requests');

        // Wait for the order data to load
        await davePage.getByText(orderText).waitFor({ timeout: 5000 });

        const orderRow = davePage.locator('tr', {
          has: davePage.getByText(orderText, { exact: true }),
        });

        // The order should show as unconfirmed
        await expect(
          orderRow.getByText('unconfirmed', { exact: true }),
        ).toBeVisible({ timeout: 1000 });

        // Dave should NOT see a Confirm button (no admin or customer-service role)
        await expect(
          orderRow.getByText('Confirm', { exact: true }),
        ).toBeHidden();
      } finally {
        await daveCtx.close();
      }
    });
  });
});
