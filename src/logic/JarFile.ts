import { combineLatest, debounceTime, distinctUntilChanged, map, Observable, switchMap } from 'rxjs';
import { jarIndex, type JarIndex } from '../workers/jar-index/client';
import type { Field, Method } from '../workers/jar-index/types';
import { classesList, fileList } from './ClassFiles';
import { getReferenceData } from '../workers/decompile/client';
import { performSearch } from './Search';
import { searchQuery, searchType, type SearchType } from './State';
import { toClassFilePath, type ClassFilePath, type ClassName } from '../utils/Names';
import { minecraftJar } from './MinecraftApi';
import type { Jar } from '../utils/Jar';

export { classesList, fileList };

const debouncedSearchQuery: Observable<string> = searchQuery.pipe(
    debounceTime(200),
    distinctUntilChanged()
);

export type SearchResult =
    | { type: "classes"; value: ClassFilePath; string?: string; stringStart?: number }
    | { type: "methods"; value: Method }
    | { type: "fields"; value: Field };

/** Classes per decompile+parse batch while resolving a string search. */
const STRING_BATCH_SIZE = 25;

/**
 * Finds classes containing a string literal.
 *
 * The constant pool only says which classes reference the literal, so each candidate class is
 * decompiled and parsed with tree-sitter to confirm the literal is really in its source and to
 * read back what it looks like.
 */
async function stringSearchResults(query: string, index: JarIndex, jar: Jar): Promise<SearchResult[]> {
    const candidates = await index.getStringReference(query);

    const results: SearchResult[] = [];
    const seen = new Set<ClassName>();

    for (let i = 0; i < candidates.length; i += STRING_BATCH_SIZE) {
        const batch = candidates.slice(i, i + STRING_BATCH_SIZE);
        const data = await getReferenceData(batch, jar);

        for (const entry of data) {
            if (seen.has(entry.className)) {
                continue;
            }

            const hit = entry.strings.find(literal => literal.text.includes(query));
            if (!hit) {
                continue;
            }

            seen.add(entry.className);
            results.push({
                type: "classes",
                value: toClassFilePath(entry.className),
                string: hit.text,
                stringStart: hit.start,
            });
        }
    }

    return results;
}

function memberSearchText(member: Method | Field): string {
    return member.split(":")[1] || member;
}

export const searchResults: Observable<SearchResult[]> = combineLatest([
    classesList, jarIndex, debouncedSearchQuery, searchType, minecraftJar,
]).pipe(
    switchMap(([classes, index, query, type, jar]): Promise<SearchResult[]> => {
        if (type === "classes") {
            return Promise.resolve(performSearch(query, classes).map(value => ({ type: "classes" as const, value })));
        }

        if (type === "strings") {
            if (query.length === 0) {
                return Promise.resolve([]);
            }

            return stringSearchResults(query, index, jar.jar);
        }

        return index.getMemberData().then(memberData => {
            if (type === "methods") {
                const members = memberData.flatMap(data => data.methods)
                    .filter((member): member is Method => member.length > 0);

                return performSearch(query, members, memberSearchText).map(value => ({ type: "methods" as const, value }));
            }

            const members = memberData.flatMap(data => data.fields)
                .filter((member): member is Field => member.length > 0);

            return performSearch(query, members, memberSearchText).map(value => ({ type: "fields" as const, value }));
        });
    })
);

export const isSearching = searchQuery.pipe(
    map((query) => query.length > 0)
);
