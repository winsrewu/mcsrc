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

/** The node tree-sitter uses for a string literal, e.g. `"hello"`. */
export const STRING_LITERAL_NODE = "string_literal";

/** A string literal found in decompiled source. `text` is the raw source text, quotes included. */
export interface AstString {
    text: string;
    start: number;
    length: number;
}

/** Strips the surrounding quotes from a Java string literal. */
export function unquoteLiteral(text: string): string {
    return text.length >= 2 && text.startsWith('"') && text.endsWith('"')
        ? text.slice(1, -1)
        : text;
}

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

/**
 * Collects every string literal in the source.
 *
 * Unlike references, a literal needs no resolving: the text written in the decompiled source
 * is the value itself, so there is no Vineflower filter to apply.
 *
 * tree-sitter splits a literal into `string_fragment` children wherever an escape appears
 * (`"tab\there"` becomes `"tab"` and `"here"`), so the fragments are joined back together.
 * `text` therefore holds the literal's content without its surrounding quotes.
 */
export function collectStrings(root: SyntaxNodeLike): AstString[] {
    const strings: AstString[] = [];

    /** Concatenates a literal's fragment text, dropping the surrounding quotes. */
    const literalText = (literal: SyntaxNodeLike): string => {
        // A literal with no children has no escapes, so its own text is the whole content.
        if (literal.childCount === 0) {
            return unquoteLiteral(literal.text);
        }

        let content = "";

        // The fragments only carry the text between escapes, so each one is read in full.
        const stack: SyntaxNodeLike[] = [literal];
        while (stack.length > 0) {
            const node = stack.pop()!;

            if (node.childCount === 0) {
                content += node.text;
                continue;
            }

            for (let i = node.childCount - 1; i >= 0; i--) {
                const child = node.child(i);
                if (child) {
                    stack.push(child);
                }
            }
        }

        return unquoteLiteral(content);
    };

    // Walk the tree, treating each literal as a single unit rather than descending into it.
    const stack: SyntaxNodeLike[] = [root];
    while (stack.length > 0) {
        const node = stack.pop()!;
        const start = node.startIndex;
        const end = node.endIndex;

        if (node.type === STRING_LITERAL_NODE) {
            if (start !== end) {
                strings.push({ text: literalText(node), start, length: end - start });
            }
            continue;
        }

        for (let i = node.childCount - 1; i >= 0; i--) {
            const child = node.child(i);
            if (child) {
                stack.push(child);
            }
        }
    }

    return strings.sort((a, b) => a.start - b.start);
}
