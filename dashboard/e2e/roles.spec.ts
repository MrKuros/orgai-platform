import { test, expect } from '@playwright/test';

test.describe('Roles', () => {
  test('dashboard loads with stats', async ({ page }) => {
    await page.goto('/dashboard');
    
    await expect(page.getByText('Dashboard')).toBeVisible();
    await expect(page.getByText('Active Policies')).toBeVisible();
    await expect(page.getByText('Roles')).toBeVisible();
    await expect(page.getByText('Team Members')).toBeVisible();
  });

  test('create role, edit, and delete', async ({ page }) => {
    await page.goto('/roles');
    
    const testRoleName = `Test Role ${Date.now()}`;
    const testDisplayName = `Test Role Display`;
    
    await page.getByRole('button', { name: 'New Role' }).click();
    
    await page.getByLabel('Role Name').fill(testRoleName);
    await page.getByLabel('Display Name').fill(testDisplayName);
    
    await page.getByRole('button', { name: 'Create Role' }).click();
    
    await expect(page.getByText(testRoleName)).toBeVisible({ timeout: 5000 });
    
    const roleCard = page.locator('.react-flow__node').filter({ hasText: testDisplayName });
    await roleCard.click();
    
    await expect(page.getByText(testDisplayName)).toBeVisible();
    
    await page.getByRole('button', { name: 'Delete Role' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    
    await expect(page.getByText(testDisplayName)).not.toBeVisible({ timeout: 5000 });
  });
});
