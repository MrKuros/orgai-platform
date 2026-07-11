import { test, expect } from '@playwright/test';

test.describe('Audit Log', () => {
  test('audit entries appear after actions', async ({ page }) => {
    await page.goto('/dashboard');
    
    await page.getByRole('link', { name: 'Policies' }).click();
    await expect(page).toHaveURL(/\/policies/);
    
    const testPolicyName = `Audit Test Policy ${Date.now()}`;
    
    await page.getByRole('button', { name: 'New Policy' }).click();
    
    await page.getByLabel('Policy Name').fill(testPolicyName);
    await page.getByLabel('Rule Description').fill('Audit test rule');
    await page.getByRole('button', { name: 'Create Policy' }).click();
    
    await expect(page.getByText(testPolicyName)).toBeVisible({ timeout: 5000 });
    
    await page.goto('/dashboard');
    
    await page.waitForSelector('text=Recent Activity', { timeout: 5000 });
    
    const activityItems = page.locator('text=policy.created');
    await expect(activityItems.first()).toBeVisible({ timeout: 5000 });
  });
});
