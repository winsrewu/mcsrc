import type { Token } from "./Tokens";

/**
 * A single identifier found in decompiled source by tree-sitter.
 * `start`/`length` are character offsets into the decompiled source of the class it was found in.
 */
export interface AstToken {
    text: string;
    kind: string;
    start: number;
    length: number;
    /** Whether Vineflower also reported a token covering this identifier. */
    covered: boolean;
}

/** Node types that name a class, method, field, parameter or local in Java source. */
const TOKEN_NODE_TYPES = new Set<string>([
    "identifier",
    "type_identifier",
]);

/** Minimal structural view of a tree-sitter node, so this module stays free of the parser dependency. */
export interface SyntaxNodeLike {
    type: string;
    text: string;
    startIndex: number;
    endIndex: number;
    childCount: number;
    child(index: number): SyntaxNodeLike | null;
}

/**
 * Collects every identifier in the source.
 *
 * Vineflower reports the spans it resolved through its token collector. An identifier that
 * overlaps one of those spans is marked covered rather than dropped, because the two are
 * needed for different things: tree-sitter finds where references are written, and the
 * Vineflower tokens are what resolve them to an exact member.
 */
export function collectIdentifiers(root: SyntaxNodeLike, covered: readonly Token[]): AstToken[] {
    // Sorted by end offset, so the first range ending after a token starts is the only
    // candidate that can overlap it. Ranges may nest, so the last such range is checked.
    const rangesByEnd = covered
        .map(token => ({ start: token.start, end: token.start + token.length }))
        .filter(range => range.end > range.start)
        .sort((a, b) => a.end - b.end);

    /** Returns true when [start, end) overlaps any covered range. */
    const isCovered = (start: number, end: number): boolean => {
        // First index with rangesByEnd[i].end > start.
        let low = 0;
        let high = rangesByEnd.length;
        while (low < high) {
            const mid = (low + high) >> 1;
            if (rangesByEnd[mid].end > start) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }

        return low < rangesByEnd.length && rangesByEnd[low].start < end;
    };

    const tokens: AstToken[] = [];
    const seen = new Set<number>();

    // Explicit stack, so the recursion depth is bounded by the tree depth only.
    const stack: SyntaxNodeLike[] = [root];
    while (stack.length > 0) {
        const node = stack.pop()!;
        const start = node.startIndex;
        const end = node.endIndex;

        if (TOKEN_NODE_TYPES.has(node.type) && start !== end && start >= 0 && !seen.has(start)) {
            seen.add(start);
            tokens.push({
                text: node.text,
                kind: node.type,
                start,
                length: end - start,
                covered: isCovered(start, end),
            });
        }

        for (let i = node.childCount - 1; i >= 0; i--) {
            const child = node.child(i);
            if (child) {
                stack.push(child);
            }
        }
    }

    return tokens.sort((a, b) => a.start - b.start);
}
