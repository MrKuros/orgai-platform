import { test, expect } from '@playwright/test';

test.describe('Audit Log', () => {
  test('audit entries appear after actions', async ({ page }) => {
    await page.goto('/policies');

    // Policy names must be slugs (lowercase letters, numbers, hyphens).
    const name = `audit-test-policy-${Date.now()}`;

    await page.getByRole('button', { name: 'New Policy' }).click();
    await page.getByLabel('Policy Name').fill(name);
    await page.getByLabel('Rule Description').fill('Audit test rule');
    await page.getByRole('button', { name: 'Save Policy' }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 10000 });

    await page.goto('/dashboard');

    await expect(page.getByText('Recent Activity')).toBeVisible({ timeout: 20000 });

    // Actions render humanized: "policy.created" -> "policy created".
    await expect(page.getByText('policy created').first()).toBeVisible({ timeout: 10000 });

    // Cleanup so repeated runs don't pile up policies in the shared org.
    await page.goto('/policies');
    const policyCard = page.locator('.bg-card', { hasText: name });
    await policyCard.getByRole('button', { name: 'Delete policy' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText(name, { exact: true })).not.toBeVisible({ timeout: 10000 });
  });
});
