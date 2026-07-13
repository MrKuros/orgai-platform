import { test, expect } from '@playwright/test';

test.describe('Policies', () => {
  test('create policy, edit, and delete', async ({ page }) => {
    await page.goto('/policies');

    // Policy names must be slugs (lowercase letters, numbers, hyphens).
    const name = `test-policy-${Date.now()}`;

    // Create
    await page.getByRole('button', { name: 'New Policy' }).click();
    await page.getByLabel('Policy Name').fill(name);
    await page.getByLabel('Rule Description').fill('Test rule description');
    await page.getByRole('button', { name: 'Save Policy' }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 10000 });

    // Edit
    const policyCard = page.locator('.bg-card', { hasText: name });
    await policyCard.getByRole('button', { name: 'Edit policy' }).click();
    await page.getByLabel('Policy Name').fill(`${name}-updated`);
    await page.getByRole('button', { name: 'Save Policy' }).click();
    await expect(page.getByText(`${name}-updated`)).toBeVisible({ timeout: 10000 });

    // Delete
    const updatedCard = page.locator('.bg-card', { hasText: `${name}-updated` });
    await updatedCard.getByRole('button', { name: 'Delete policy' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText(`${name}-updated`)).not.toBeVisible({ timeout: 10000 });
  });
});
