import { test, expect } from '@playwright/test';

test.describe('Team', () => {
  test('invite member, change role, and remove', async ({ page }) => {
    await page.goto('/team');

    const testEmail = `test-member-${Date.now()}@example.com`;
    const memberRow = page.locator('table tbody tr').filter({ hasText: testEmail });

    // Invite ("Platform Access Level" is now "Access Level")
    await page.getByRole('button', { name: 'Invite Member' }).click();
    await page.getByLabel('Email Address').fill(testEmail);
    await page.getByLabel('Access Level').click();
    await page.getByRole('option', { name: 'Member (View Only)' }).click();
    await page.getByRole('button', { name: 'Send Invite' }).click();

    // Scope to the table row — the success toast also contains the email.
    await expect(memberRow).toBeVisible({ timeout: 10000 });

    // Change access level
    await memberRow.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('menuitem', { name: 'Edit Roles' }).click();

    await page.getByLabel('Access Level').click();
    await page.getByRole('option', { name: 'Policy Admin (Edit Policies)' }).click();
    await page.getByRole('button', { name: 'Save Changes' }).click();

    // Badge renders the enum with the underscore replaced: "POLICY ADMIN".
    await expect(memberRow.getByText('POLICY ADMIN')).toBeVisible({ timeout: 10000 });

    // Remove
    await memberRow.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('menuitem', { name: 'Remove from Org' }).click();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();

    await expect(memberRow).toHaveCount(0, { timeout: 10000 });
  });
});
