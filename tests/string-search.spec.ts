import { test, expect, type Page } from '@playwright/test';
import { waitForDecompiledContent, setupTest } from './test-utils';

/**
 * String literal search: the constant pool index names the candidate classes, then each
 * candidate is decompiled and parsed with tree-sitter to confirm and read back the literal.
 */

async function selectStringsSearch(page: Page) {
    await page.getByRole('button', { name: 'Search type' }).click();
    await page.getByText('Strings', { exact: true }).click();
}

test.describe('String literal search', () => {
    test.beforeEach(async ({ page }) => {
        await setupTest(page);
    });

    test('finds the class containing a literal and shows it', async ({ page }) => {
        await page.goto('/');
        await page.getByText('ChatFormatting', { exact: true }).click();
        await waitForDecompiledContent(page, 'enum ChatFormatting');

        await selectStringsSearch(page);

        const searchBox = page.getByRole('searchbox', { name: 'Search strings' });
        await searchBox.fill('EXAMPLE');

        const result = page.locator('.ant-list-item').first();
        await expect(result).toContainText('ChatFormatting', { timeout: 90000 });
        await expect(result).toContainText('EXAMPLE');
    });

    test('opens the class and highlights the literal', async ({ page }) => {
        await page.goto('/');
        await page.getByText('ChatFormatting', { exact: true }).click();
        await waitForDecompiledContent(page, 'enum ChatFormatting');

        await selectStringsSearch(page);

        const searchBox = page.getByRole('searchbox', { name: 'Search strings' });
        await searchBox.fill('EXAMPLE');

        const result = page.locator('.ant-list-item').first();
        await expect(result).toContainText('ChatFormatting', { timeout: 90000 });
        await result.click();

        // The class is opened and the literal is selected, which Monaco renders as a
        // selection overlay covering the highlighted token.
        const editor = page.locator('.monaco-editor').first();
        await expect(editor).toContainText('EXAMPLE');

        const selection = page.locator('.monaco-editor .selected-text, .monaco-editor .selection').first();
        await expect(selection).toBeVisible({ timeout: 30000 });

        const box = await selection.boundingBox();
        console.log('selection box:', JSON.stringify(box));
        expect(box?.width ?? 0).toBeGreaterThan(0);
    });

    test('reports no class for a literal that is not present', async ({ page }) => {
        await page.goto('/');
        await page.getByText('ChatFormatting', { exact: true }).click();
        await waitForDecompiledContent(page, 'enum ChatFormatting');

        await selectStringsSearch(page);

        const searchBox = page.getByRole('searchbox', { name: 'Search strings' });
        await searchBox.fill('this literal does not exist anywhere');

        await expect(page.locator('.ant-list-item')).toHaveCount(0, { timeout: 90000 });
    });
});
