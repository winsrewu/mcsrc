import { combineLatest, debounceTime, distinctUntilChanged, map, Observable, switchMap } from 'rxjs';
import { jarIndex, type JarIndex } from '../workers/jar-index/client';
import type { Field, Method } from '../workers/jar-index/types';
import { classesList, fileList } from './ClassFiles';
import { performSearch } from './Search';
import { searchQuery, searchType, type SearchType } from './State';
import type { ClassFilePath } from '../utils/Names';

export { classesList, fileList };

const debouncedSearchQuery: Observable<string> = searchQuery.pipe(
    debounceTime(200),
    distinctUntilChanged()
);

export type SearchResult =
    | { type: "classes"; value: ClassFilePath }
    | { type: "methods"; value: Method }
    | { type: "fields"; value: Field };

function memberSearchText(member: Method | Field): string {
    return member.split(":")[1] || member;
}

export const searchResults: Observable<SearchResult[]> = combineLatest([classesList, jarIndex, debouncedSearchQuery, searchType]).pipe(
    switchMap(([classes, index, query, type]): Promise<SearchResult[]> => {
        if (type === "classes") {
            return Promise.resolve(performSearch(query, classes).map(value => ({ type: "classes" as const, value })));
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
