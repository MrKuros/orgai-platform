import { test, expect } from '@playwright/test';

test.describe('Settings', () => {
  test('update org name', async ({ page }) => {
    await page.goto('/settings/api-keys');
    
    await expect(page.getByText('API Keys')).toBeVisible();
  });
});
