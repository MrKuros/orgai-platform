import { test, expect } from '@playwright/test';

test.describe('Team', () => {
  test('invite member, change role, and remove', async ({ page }) => {
    await page.goto('/team');
    
    const testEmail = `test-member-${Date.now()}@example.com`;
    
    await page.getByRole('button', { name: 'Invite Member' }).click();
    
    await page.getByLabel('Email Address').fill(testEmail);
    await page.getByLabel('Platform Access Level').click();
    await page.getByRole('option', { name: 'Member (View Only)' }).click();
    
    await page.getByRole('button', { name: 'Send Invite' }).click();
    
    await expect(page.getByText(testEmail)).toBeVisible({ timeout: 5000 });
    
    const memberRow = page.locator('table tbody tr').filter({ hasText: testEmail });
    await memberRow.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('menuitem', { name: 'Edit Roles' }).click();
    
    await page.getByLabel('Platform Access Level').click();
    await page.getByRole('option', { name: 'Policy Admin (Edit Policies)' }).click();
    
    await page.getByRole('button', { name: 'Save Changes' }).click();
    
    await expect(page.getByText('Policy Admin')).toBeVisible({ timeout: 5000 });
    
    await memberRow.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('menuitem', { name: 'Remove from Org' }).click();
    await page.getByRole('button', { name: 'Remove' }).click();
    
    await expect(page.getByText(testEmail)).not.toBeVisible({ timeout: 5000 });
  });
});
