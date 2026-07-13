import { test as setup, expect } from '@playwright/test';

const authFile = '.auth/user.json';

setup('authenticate', async ({ page, request }) => {
  const email = process.env.E2E_TEST_EMAIL || 'e2e@test.dev';
  const password = process.env.E2E_TEST_PASSWORD || 'password123';
  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

  // Self-seeding: create the user + org if they don't exist yet, so CI needs
  // no pre-provisioned account or secrets. 409 (already exists) is fine.
  await request
    .post(`${apiBase}/v1/auth/signup`, {
      data: {
        email,
        password,
        firstName: 'E2E',
        lastName: 'Tester',
        orgName: 'E2E Org',
        orgSlug: 'e2e-org',
      },
    })
    .catch(() => {});

  await page.goto('/login');

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();

  // Generous timeout: first navigation against a dev server cold-compiles
  // the /dashboard route and can exceed the 5s default.
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20000 });

  await page.context().storageState({ path: authFile });
});

export { authFile };
