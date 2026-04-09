import { expect, test } from '@playwright/test';

// Session 1 smoke test:
// 1. load the app
// 2. complete the 3-screen onboarding with a bodyweight
// 3. navigate to Log and update the weight
// 4. reload the page
// 5. weight still present (IndexedDB persisted)

test('onboarding, log a weight, reload, weight persists', async ({ page }) => {
  await page.goto('/');

  // Onboarding screen 1 — Welcome
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Onboarding screen 2 — Pick phase (default Phase 0)
  await expect(page.getByRole('heading', { name: 'Pick your phase' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Onboarding screen 3 — Quick baseline
  await expect(page.getByRole('heading', { name: 'Quick baseline' })).toBeVisible();
  await page.locator('#ob-weight').fill('165');
  await page.getByRole('button', { name: 'Finish' }).click();

  // Land on Today — assert the heading exists
  await expect(page.locator('jamie-today h1')).toBeVisible();

  // Navigate to Log tab via hash
  await page.evaluate(() => {
    window.location.hash = '#/log';
  });
  await expect(page.locator('jamie-log h1')).toHaveText('Daily log');

  // Update the weight field explicitly, blur to save
  const weightInput = page.locator('#log-weight');
  await expect(weightInput).toBeVisible();
  await weightInput.fill('166');
  await weightInput.blur();

  // Give IDB a tick
  await page.waitForTimeout(200);

  // Reload — should bypass onboarding (already onboarded) and land somewhere
  await page.reload();

  // Navigate back to log and confirm value
  await page.evaluate(() => {
    window.location.hash = '#/log';
  });
  const reloaded = page.locator('#log-weight');
  await expect(reloaded).toHaveValue('166.0');
});
