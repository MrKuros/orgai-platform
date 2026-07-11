import { test, expect } from '@playwright/test';

test.describe('Policies', () => {
  test('create policy, edit, and delete', async ({ page }) => {
    await page.goto('/policies');
    
    const testPolicyName = `Test Policy ${Date.now()}`;
    
    // Create
    await page.getByRole('button', { name: 'New Policy' }).click();
    await page.getByLabel('Policy Name').fill(testPolicyName);
    await page.getByLabel('Rule Description').fill('Test rule description');
    await page.getByRole('button', { name: 'Create Policy' }).click();
    await expect(page.getByText(testPolicyName)).toBeVisible({ timeout: 5000 });
    
    // Edit
    const policyCard = page.locator('.bg-card', { hasText: testPolicyName });
    await policyCard.locator('button').filter({ has: page.locator('svg.lucide-pencil') }).first().click();
    await page.getByLabel('Policy Name').fill(`${testPolicyName} Updated`);
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByText(`${testPolicyName} Updated`)).toBeVisible({ timeout: 5000 });
    
    // Delete
    const updatedCard = page.locator('.bg-card', { hasText: `${testPolicyName} Updated` });
    await updatedCard.locator('button').filter({ has: page.locator('svg.lucide-trash-2') }).first().click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(`${testPolicyName} Updated`)).not.toBeVisible({ timeout: 5000 });
  });
});
