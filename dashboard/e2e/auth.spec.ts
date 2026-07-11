import { test, expect } from '@playwright/test';

test.describe('Auth', () => {
  test('login page loads correctly', async ({ page }) => {
    await page.goto('/login');
    
    await expect(page.getByText('Welcome back')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  });

  test('signup page loads correctly', async ({ page }) => {
    await page.goto('/signup');
    
    await expect(page.getByText('Create an account')).toBeVisible();
    await expect(page.getByLabel('First name')).toBeVisible();
    await expect(page.getByLabel('Last name')).toBeVisible();
    await expect(page.getByLabel('Work Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByLabel('Organization name')).toBeVisible();
    await expect(page.getByLabel('Organization slug')).toBeVisible();
  });
});
