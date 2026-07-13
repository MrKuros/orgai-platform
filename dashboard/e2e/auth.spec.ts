import { test, expect } from '@playwright/test';

test.describe('Auth', () => {
  // Auth pages redirect to /dashboard when a session exists (middleware),
  // so run these without the shared authenticated storage state.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('login page loads correctly', async ({ page }) => {
    await page.goto('/login');

    // Generous timeout: dev server may cold-compile the route.
    await expect(page.getByText('Welcome back')).toBeVisible({ timeout: 20000 });
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  });

  test('signup page loads correctly', async ({ page }) => {
    await page.goto('/signup');

    await expect(page.getByText('Create an account')).toBeVisible({ timeout: 20000 });
    await expect(page.getByLabel('First name')).toBeVisible();
    await expect(page.getByLabel('Last name')).toBeVisible();
    await expect(page.getByLabel('Work Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByLabel('Organization name')).toBeVisible();
    await expect(page.getByLabel('Organization slug')).toBeVisible();
  });
});
