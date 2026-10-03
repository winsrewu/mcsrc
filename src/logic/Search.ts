export function getCamelCaseAcronym(str: string): string {
    return str.replace(/[^A-Z]/g, '');
}

export function matchesCamelCase(className: string, query: string): boolean {
    const acronym = getCamelCaseAcronym(className);
    return acronym.toLowerCase().startsWith(query.toLowerCase());
}

/**
 * Score for a single search text, or undefined when it does not match.
 * Lower is better; scoring is shared with the AST-powered search.
 */
export function scoreSearchText(searchText: string, lowerQuery: string, query: string): number | undefined {
    const simpleName = searchText.split('/').pop() || searchText;
    const lowerSimpleName = simpleName.toLowerCase();

    if (!lowerSimpleName.includes(lowerQuery) && !matchesCamelCase(simpleName, query)) {
        return undefined;
    }

    if (lowerSimpleName === lowerQuery) {
        return 0;
    }
    if (lowerSimpleName.startsWith(lowerQuery)) {
        return 1;
    }
    if (getCamelCaseAcronym(simpleName).toLowerCase() === lowerQuery) {
        return 2;
    }
    if (matchesCamelCase(simpleName, query)) {
        return 3;
    }
    return 4 + lowerSimpleName.indexOf(lowerQuery);
}

// Vibe coded mess that no one other than copilot or should read or touch :D
export function performSearch<T extends string>(query: string, classes: T[], getSearchText: (item: T) => string = item => item): T[] {
    if (query.length === 0) {
        return [];
    }

    const lowerQuery = query.toLowerCase();

    const results = classes
        .map(className => ({ className, score: scoreSearchText(getSearchText(className), lowerQuery, query) }))
        .filter((result): result is { className: T; score: number } => result.score !== undefined)
        .sort((a, b) => {
            if (a.score !== b.score) {
                return a.score - b.score;
            }

            const aText = getSearchText(a.className);
            const bText = getSearchText(b.className);
            const aSimple = aText.split('/').pop() || aText;
            const bSimple = bText.split('/').pop() || bText;
            if (aSimple.length !== bSimple.length) {
                return aSimple.length - bSimple.length;
            }

            return aSimple.localeCompare(bSimple);
        })
        .slice(0, 100)
        .map(result => result.className);

    return results;
}

import type { ClassFilePath } from "../utils/Names";
