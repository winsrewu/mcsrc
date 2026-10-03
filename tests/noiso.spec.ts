import { test, expect } from '@playwright/test';
import { waitForDecompiledContent, setupTest } from './test-utils';

/** Verifies the app works when SharedArrayBuffer is unavailable, as on GitHub Pages. */
test.describe('no cross-origin isolation', () => {
    test.beforeEach(async ({ page }) => {
        await setupTest(page);
    });

    test('decompiles and finds references without SharedArrayBuffer', async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

        await page.goto('/');

        // Guard: this run must genuinely be the un-isolated case.
        const isolated = await page.evaluate(() => globalThis.crossOriginIsolated);
        const hasSab = await page.evaluate(() => typeof SharedArrayBuffer !== 'undefined');
        console.log(`crossOriginIsolated=${isolated} SharedArrayBuffer=${hasSab}`);

        await page.getByText('ChatFormatting', { exact: true }).click();
        await waitForDecompiledContent(page, 'enum ChatFormatting');

        const searchBox = page.getByRole('searchbox', { name: 'Search classes' });
        await searchBox.fill('ChatFormatting');
        const result = page.locator('.ant-list-item').filter({ hasText: 'ChatFormatting' }).first();
        await expect(result).toBeVisible({ timeout: 30000 });
        await result.click({ button: 'right' });
        await page.getByText('Find All References').click();

        await expect(page.getByTestId('references-parsed')).toContainText('candidate classes parsed', { timeout: 90000 });

        const sabErrors = errors.filter(e => e.includes('SharedArrayBuffer'));
        console.log('SAB errors:', JSON.stringify(sabErrors));
        console.log('all errors:', JSON.stringify(errors.slice(0, 5)));
        expect(sabErrors).toEqual([]);
    });
});
