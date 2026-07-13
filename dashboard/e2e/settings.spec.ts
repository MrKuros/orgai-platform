import { test, expect } from '@playwright/test';

test.describe('Settings', () => {
  test('API keys page loads', async ({ page }) => {
    await page.goto('/settings/api-keys');

    await expect(page.getByRole('heading', { name: 'API Keys', exact: true })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'New API Key' })).toBeVisible();
  });
});
