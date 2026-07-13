import { test, expect } from '@playwright/test';

test.describe('Roles', () => {
  test('dashboard loads with stats', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 20000 });

    // Scope to <main> — the sidebar nav also contains "Roles" etc.
    const main = page.getByRole('main');
    await expect(main.getByText('Active Policies')).toBeVisible();
    await expect(main.getByText('Roles', { exact: true })).toBeVisible();
    await expect(main.getByText('Team Members')).toBeVisible();
  });

  test('create role, inspect, and delete', async ({ page }) => {
    await page.goto('/roles');

    const ts = Date.now();
    const roleName = `test-role-${ts}`; // slug: lowercase, numbers, hyphens
    const displayName = `Test Role ${ts}`;

    await page.getByRole('button', { name: 'New Role' }).click();

    await page.getByLabel('Display Name').fill(displayName);
    await page.getByLabel('System Name').fill(roleName);

    await page.getByRole('button', { name: 'Create Role' }).click();

    const node = page.locator('.react-flow__node', { hasText: displayName });
    await expect(node).toBeVisible({ timeout: 10000 });
    await node.click();

    // Side panel shows the role details.
    await expect(page.getByRole('heading', { name: displayName })).toBeVisible();

    await page.getByRole('button', { name: 'Delete Role' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(node).toHaveCount(0, { timeout: 10000 });
  });
});
