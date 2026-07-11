import { test as setup, expect } from '@playwright/test';

const authFile = '.auth/user.json';

setup('authenticate', async ({ page }) => {
  await page.goto('/login');
  
  const email = process.env.E2E_TEST_EMAIL || 'test@example.com';
  const password = process.env.E2E_TEST_PASSWORD || 'password123';
  
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  
  await expect(page).toHaveURL(/\/dashboard/);
  
  await page.context().storageState({ path: authFile });
});

export { authFile };
