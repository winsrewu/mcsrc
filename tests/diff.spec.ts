import { test, expect } from '@playwright/test';
import { setupTest, selectMinecraftVersion } from './test-utils';

test.describe('Diff View', () => {
    test.beforeEach(async ({ page }) => {
        await setupTest(page);
    });

    for (let i = 0; i < 100; i++) {
        test('Opens diff view and selects LevelRenderer' + i, async ({ page }) => {
            await page.goto('/');
            await expect(page.locator('.ant-modal-wrap')).toBeHidden();

            await page.getByRole('button', { name: 'Compare' }).click();
    });
    }
});
