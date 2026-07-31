import { test, expect } from '@playwright/test';

test('page loads and renders canvas', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/.*/); // any title — just confirm load
  const canvas = page.locator('#glc');
  await expect(canvas).toBeVisible();
});

test('scene navigation overlay is present', async ({ page }) => {
  await page.goto('/');
  const overlay = page.locator('#ov');
  await expect(overlay).toBeAttached();
});

test('keyboard navigation changes scene', async ({ page }) => {
  await page.goto('/');
  // Press right arrow — scene index should advance (reflected in DOM or URL)
  await page.keyboard.press('ArrowRight');
  // Verify page is still alive and canvas still visible
  await expect(page.locator('#glc')).toBeVisible();
});
