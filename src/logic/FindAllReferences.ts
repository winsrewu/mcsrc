import { BehaviorSubject, distinctUntilChanged, from, map, Observable, switchMap, throttleTime } from "rxjs";
import { jarIndex } from "../workers/jar-index/client";
import { getReferenceData } from "../workers/decompile/client";
import { openCodeTab } from "./tabs";
import { minecraftJar } from "./MinecraftApi";
import { referencesQuery } from "./State";
import type { Token } from "./Tokens";
import type { DecompileResult } from "../workers/decompile/types";
import type { ReferenceKey, ReferenceString } from "../workers/jar-index/types";
import { classNameFromClassFilePath, toClassFilePath, toClassName, type ClassName } from "../utils/Names";
import { findReferenceSites, parseReferenceTarget } from "./AstReferences";

/** How many candidate classes are decompiled and parsed per batch. */
const BATCH_SIZE = 25;

export interface ReferenceSite {
    className: ClassName;
    /** Character offset into the decompiled source. */
    start: number;
    length: number;
    /** Zero-based line the reference sits on. */
    line: number;
    /** The source line the reference sits on, for display. */
    preview: string;
}

export interface ReferenceGroup {
    className: ClassName;
    references: ReferenceSite[];
}

export interface ReferenceState {
    groups: ReferenceGroup[];
    analyzed: number;
    total: number;
}

/** Formats a reference string to be displayed by the user. */
export function formatReference(reference: ReferenceString): string {
    if (reference.startsWith("m:")) {
        const parts = reference.slice(2).split(":");
        return `${parts[1]}${parts[2]}`;
    }
    if (reference.startsWith("f:")) {
        const parts = reference.slice(2).split(":");
        return parts[1];
    }
    if (reference.startsWith("c:")) {
        return reference.slice(2);
    }
    return reference;
}

export function formatReferenceQuery(query: ReferenceKey): string {
    const type = getQueryType(query);

    switch (type) {
        case "class":
            return query.split("/").pop() || query;
        case "method": {
            const parts = query.split(":");
            const className = parts[0].split("/").pop() || parts[0];
            return `${className}.${parts[1]}${parts[2]}`;
        }
        case "field": {
            const parts = query.split(":");
            const className = parts[0].split("/").pop() || parts[0];
            return `${className}.${parts[1]}`;
        }
    }
}

function getQueryType(query: ReferenceKey): "class" | "method" | "field" {
    if (query.includes(":")) {
        const parts = query.split(":");
        if (parts[2].includes("(")) {
            return "method";
        } else {
            return "field";
        }
    }
    return "class";
}

/** Line and preview text for an offset in the decompiled source. */
function locate(source: string, start: number): { line: number; preview: string } {
    // Walk out to the line bounds instead of splitting the whole source for every site.
    let lineStart = start;
    while (lineStart > 0 && source.charCodeAt(lineStart - 1) !== 10) {
        lineStart--;
    }

    let lineEnd = start;
    while (lineEnd < source.length && source.charCodeAt(lineEnd) !== 10) {
        lineEnd++;
    }

    let line = 0;
    for (let i = source.indexOf("\n"); i !== -1 && i < start; i = source.indexOf("\n", i + 1)) {
        line++;
    }

    return { line, preview: source.slice(lineStart, lineEnd).trim() };
}

/**
 * Finds where a class or member is referenced.
 *
 * The bytecode index picks the candidate classes that reference the target. Only those are
 * decompiled and parsed with tree-sitter, which finds the reference sites in the source.
 * The syntax tree cannot tell `AClass.foo()` from `BClass.foo()`, so each site is only kept
 * when a Vineflower token at that position resolves to the target.
 */
export const referenceResults: Observable<ReferenceState> = referencesQuery.pipe(
    throttleTime(200),
    distinctUntilChanged(),
    switchMap(query => {
        if (!query) {
            return from([{ groups: [], analyzed: 0, total: 0 }]);
        }

        return jarIndex.pipe(
            switchMap(index => minecraftJar.pipe(
                switchMap(jar => new Observable<ReferenceState>(subscriber => {
                    let cancelled = false;

                    void (async () => {
                        try {
                            const raw = await index.getReference(query as ReferenceKey);
                            const candidates = [...new Set(raw.map(reference => toClassName(reference.slice(2).split(":")[0])))];

                            const target = parseReferenceTarget(query as ReferenceKey);
                            const sites = new Map<ClassName, ReferenceSite[]>();

                            const emit = (analyzed: number) => subscriber.next({
                                groups: [...sites.entries()].map(([className, references]) => ({ className, references })),
                                analyzed,
                                total: candidates.length,
                            });

                            emit(0);

                            for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
                                if (cancelled) return;

                                const batch = candidates.slice(i, i + BATCH_SIZE);
                                const data = await getReferenceData(batch, jar.jar);

                                for (const entry of data) {
                                    const found = findReferenceSites(entry.identifiers, entry.resolved, target);
                                    if (found.length === 0) {
                                        continue;
                                    }

                                    sites.set(entry.className, found.map(site => ({
                                        className: entry.className,
                                        start: site.start,
                                        length: site.length,
                                        ...locate(entry.source, site.start),
                                    })));
                                }

                                emit(Math.min(i + BATCH_SIZE, candidates.length));
                            }

                            subscriber.complete();
                        } catch (e) {
                            console.error("find-references failed", e);
                            subscriber.error(e);
                        }
                    })();

                    return () => {
                        cancelled = true;
                    };
                }))
            ))
        );
    })
);

export const isViewingReferences = referencesQuery.pipe(
    map((query) => query.length > 0)
);

interface ReferenceNavigation {
    /** The class to navigate to. */
    className: ClassName;
    /** The reference site to select in that class. */
    site: ReferenceSite;
}

export const nextReferenceNavigation = new BehaviorSubject<ReferenceNavigation | undefined>(undefined);

export function goToReference(site: ReferenceSite) {
    const className = classNameFromClassFilePath(toClassFilePath(site.className));
    openCodeTab(toClassFilePath(className));
    nextReferenceNavigation.next({ className, site });
}

/**
 * The token to select once the referenced class has been decompiled. The reference offset
 * came from tree-sitter running over the same source, so it points straight at the reference.
 */
export function getNextJumpToken(decompileResult: DecompileResult): Token | undefined {
    const navigation = nextReferenceNavigation.getValue();

    if (!navigation || decompileResult.className !== navigation.className) {
        return undefined;
    }

    nextReferenceNavigation.next(undefined);

    const { start } = navigation.site;
    return decompileResult.tokens.find(token => token.start === start)
        ?? decompileResult.tokens.find(token => token.start <= start && start < token.start + token.length);
}
