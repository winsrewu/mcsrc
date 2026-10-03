import { test, expect, type Page } from '@playwright/test';
import { waitForDecompiledContent, setupTest } from './test-utils';

/**
 * The reworked find-references flow: the bytecode index names the candidate classes,
 * tree-sitter locates the reference sites in their decompiled source, and the Vineflower
 * tokens filter each site down to an exact member.
 */

/** Starts a find-references query through the search result context menu. */
async function findReferences(page: Page, query: string) {
    const searchBox = page.getByRole('searchbox', { name: 'Search classes' });
    await searchBox.fill(query);

    const result = page.locator('.ant-list-item').filter({ hasText: query }).first();
    await expect(result).toBeVisible({ timeout: 30000 });
    await result.click({ button: 'right' });

    await page.getByText('Find All References').click();
}

test.describe('Find All References (AST + VF filter)', () => {
    test.beforeEach(async ({ page }) => {
        await setupTest(page);
    });

    test('parses the candidate class and reports the reference site', async ({ page }) => {
        await page.goto('/');
        await page.getByText('ChatFormatting', { exact: true }).click();
        await waitForDecompiledContent(page, 'enum ChatFormatting');

        // ChatFormatting is referenced by its own generated members, so the bytecode
        // index has it as a candidate and the parser confirms the sites.
        await findReferences(page, 'ChatFormatting');

        const panel = page.getByTestId('reference-results');
        await expect(page.getByTestId('references-parsed')).toContainText('candidate classes parsed', { timeout: 90000 });
        await expect(panel.getByTestId('reference-group')).toHaveCount(1, { timeout: 90000 });
        await expect(panel.getByTestId('reference-group')).toContainText('ChatFormatting');

        // The enum declaration is where the class references itself.
        const site = panel.getByTestId('reference-site').first();
        await expect(site).toContainText('public enum ChatFormatting');
    });

    test('jumps to the confirmed reference site in the editor', async ({ page }) => {
        await page.goto('/');
        await page.getByText('ChatFormatting', { exact: true }).click();
        await waitForDecompiledContent(page, 'enum ChatFormatting');

        await findReferences(page, 'ChatFormatting');

        const site = page.getByTestId('reference-site').first();
        await expect(site).toBeVisible({ timeout: 90000 });
        await site.click();

        // Selecting the site reveals the declaration line the reference sits on.
        const editor = page.getByRole('code').first();
        await expect(editor.locator('.selected-text, .selection').first()).toBeVisible({ timeout: 30000 });
        await expect(editor).toContainText('public enum ChatFormatting');
    });

    test('reports no reference for a member nothing calls', async ({ page }) => {
        await page.goto('/');
        await page.getByText('ChatFormatting', { exact: true }).click();
        await waitForDecompiledContent(page, 'enum ChatFormatting');

        // exampleMethod is a member, so it is only findable with member search.
        await page.getByRole('button', { name: 'Search type' }).click();
        await page.getByText('Methods', { exact: true }).click();

        await findReferences(page, 'exampleMethod');

        // Candidates are still parsed, they just contain no matching reference.
        await expect(page.getByTestId('references-parsed')).toContainText('candidate classes parsed', { timeout: 90000 });
        await expect(page.getByText('No references found.')).toBeVisible({ timeout: 90000 });
    });
});
