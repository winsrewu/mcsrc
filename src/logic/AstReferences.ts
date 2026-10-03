import type { AstToken } from "./AstSearch";
import type { Token } from "./Tokens";

/** Trailing simple name of an internal class name, e.g. `a/b/Outer$Inner` -> `Inner`. */
function simpleClassName(className: string): string {
    const simple = className.slice(className.lastIndexOf("/") + 1);
    const inner = simple.lastIndexOf("$");
    return inner >= 0 ? simple.slice(inner + 1) : simple;
}

export type ReferenceTargetKind = "method" | "field" | "class";

export interface ReferenceTarget {
    kind: ReferenceTargetKind;
    /** Internal class name, e.g. `net/minecraft/ChatFormatting`. */
    className: string;
    /** Member name; the class is matched by simple name for class targets. */
    name: string;
    /** JVM descriptor; only used for method targets. */
    descriptor?: string;
}

export interface ReferenceSite {
    /** Character offset of the reference in the decompiled source. */
    start: number;
    length: number;
    kind: ReferenceTargetKind;
}

/** Parses the reference key used by the find-all-references system. */
export function parseReferenceTarget(query: string): ReferenceTarget {
    const parts = query.split(":");

    if (parts.length < 3) {
        const className = parts[0];
        return {
            kind: "class",
            className,
            name: simpleClassName(className),
        };
    }

    const isMethod = parts[2].startsWith("(");
    return {
        kind: isMethod ? "method" : "field",
        // A reference key may point at a member of an inner class, while the name is declared on the outer one.
        className: parts[0],
        name: parts[1],
        descriptor: isMethod ? parts[2] : undefined,
    };
}

/** Whether a Vineflower token resolves exactly to the target. */
function matchesTarget(token: Token, target: ReferenceTarget): boolean {
    switch (token.type) {
        case "method":
            if (target.kind !== "method") return false;
            return token.className === target.className
                && token.name === target.name
                && token.descriptor === target.descriptor;
        case "field":
            if (target.kind !== "field") return false;
            return token.className === target.className
                && token.name === target.name;
        case "class":
            if (target.kind !== "class") return false;
            // The source writes the simple name; Vineflower reports the resolved class.
            return token.className === target.className
                || simpleClassName(token.className) === target.name;
        default:
            return false;
    }
}

/**
 * Finds every place the target is referenced.
 *
 * tree-sitter says where a reference could be written — it sees `foo()` but cannot tell
 * `AClass.foo()` from `BClass.foo()`. Vineflower already resolved each identifier span to an
 * exact member, so an identifier is only a reference to the target when a resolved token
 * overlapping it matches the target exactly. That is the filter.
 */
export function findReferenceSites(
    identifiers: readonly AstToken[],
    resolved: readonly Token[],
    target: ReferenceTarget,
): ReferenceSite[] {
    // Resolved tokens indexed by the offset where they start.
    const byStart = new Map<number, Token[]>();
    for (const token of resolved) {
        const bucket = byStart.get(token.start);
        if (bucket) {
            bucket.push(token);
        } else {
            byStart.set(token.start, [token]);
        }
    }

    const sites: ReferenceSite[] = [];

    for (const identifier of identifiers) {
        const end = identifier.start + identifier.length;

        // The common case: Vineflower reported the reference at the same offset.
        const candidates = byStart.get(identifier.start) ?? [];

        // Fall back to any resolved token overlapping the identifier, which covers spans
        // that only cover part of what the source writes.
        if (candidates.length === 0) {
            for (const token of resolved) {
                if (token.start < end && identifier.start < token.start + token.length) {
                    candidates.push(token);
                }
            }
        }

        if (candidates.some(token => matchesTarget(token, target))) {
            sites.push({
                start: identifier.start,
                length: identifier.length,
                kind: target.kind,
            });
        }
    }

    return sites;
}
