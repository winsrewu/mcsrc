import { describe, it, expect } from "vitest";
import { collectIdentifiers, collectStrings, unquoteLiteral, type AstToken, type SyntaxNodeLike } from "./AstSearch";
import { findReferenceSites, parseReferenceTarget, type ReferenceTarget } from "./AstReferences";
import type { Token } from "./Tokens";
import type { ClassName } from "../utils/Names";

/** Builds a syntax tree shaped like the tree-sitter nodes the extractor walks. */
interface Leaf {
    type: string;
    text: string;
}

function leaves(spec: Leaf[], source: string, from = 0): SyntaxNodeLike[] {
    let cursor = from;

    return spec.map(leaf => {
        const index = source.indexOf(leaf.text, cursor);
        if (index < 0) {
            throw new Error(`leaf '${leaf.text}' not found from ${cursor}`);
        }
        cursor = index + leaf.text.length;

        return {
            type: leaf.type,
            text: leaf.text,
            startIndex: index,
            endIndex: cursor,
            childCount: 0,
            child: () => null,
        };
    });
}

function node(type: string, children: SyntaxNodeLike[], startIndex: number, endIndex: number): SyntaxNodeLike {
    return { type, text: "", startIndex, endIndex, childCount: children.length, child: i => children[i] ?? null };
}

function treeOf(spec: Leaf[], source: string): SyntaxNodeLike {
    const children = leaves(spec, source);
    return node("program", children, 0, source.length);
}

function methodToken(start: number, length: number, className: string, name: string, descriptor: string): Token {
    return { type: "method", start, length, className: className as ClassName, name, descriptor, declaration: false };
}

function fieldToken(start: number, length: number, className: string, name: string, descriptor: string): Token {
    return { type: "field", start, length, className: className as ClassName, name, descriptor, declaration: false };
}

/** Reference site lookup helper: the offsets the matcher reported. */
function sites(identifiers: AstToken[], resolved: Token[], target: ReferenceTarget): number[] {
    return findReferenceSites(identifiers, resolved, target).map(site => site.start);
}

describe("collectIdentifiers", () => {
    it("collects identifier and type_identifier nodes with their spans", () => {
        const source = "foo(bar, Baz)";
        const root = treeOf([
            { type: "identifier", text: "foo" },
            { type: "identifier", text: "bar" },
            { type: "type_identifier", text: "Baz" },
        ], source);

        const tokens = collectIdentifiers(root, []);
        expect(tokens.map(t => t.text)).toEqual(["foo", "bar", "Baz"]);
        expect(tokens[0]).toMatchObject({ start: 0, length: 3, kind: "identifier", covered: false });
        expect(tokens[2]).toMatchObject({ start: 9, length: 3, kind: "type_identifier", covered: false });
    });

    it("ignores node types that are not identifiers", () => {
        const source = "foo 42";
        const root = treeOf([
            { type: "identifier", text: "foo" },
            { type: "decimal_integer_literal", text: "42" },
        ], source);

        expect(collectIdentifiers(root, []).map(t => t.text)).toEqual(["foo"]);
    });

    it("marks identifiers that Vineflower resolved as covered", () => {
        const source = "alpha beta gamma";
        const root = treeOf([
            { type: "identifier", text: "alpha" },
            { type: "identifier", text: "beta" },
            { type: "identifier", text: "gamma" },
        ], source);

        const tokens = collectIdentifiers(root, [methodToken(6, 4, "a/B", "beta", "()V")]);
        expect(tokens.map(t => [t.text, t.covered])).toEqual([
            ["alpha", false],
            ["beta", true],
            ["gamma", false],
        ]);
    });

    it("marks an identifier covered when a resolved span starts inside it", () => {
        const source = "LevelRenderer";
        const root = treeOf([{ type: "identifier", text: "LevelRenderer" }], source);

        const tokens = collectIdentifiers(root, [methodToken(5, 8, "a/B", "Renderer", "()V")]);
        expect(tokens[0].covered).toBe(true);
    });

    it("returns tokens ordered by position", () => {
        const source = "aaa bbb ccc";
        const children = leaves([
            { type: "identifier", text: "aaa" },
            { type: "identifier", text: "bbb" },
            { type: "identifier", text: "ccc" },
        ], source);
        const root = node("program", [children[2], children[0], children[1]], 0, source.length);

        expect(collectIdentifiers(root, []).map(t => t.text)).toEqual(["aaa", "bbb", "ccc"]);
    });
});

describe("parseReferenceTarget", () => {
    it("parses a class reference key", () => {
        expect(parseReferenceTarget("net/minecraft/ChatFormatting")).toEqual({
            kind: "class",
            className: "net/minecraft/ChatFormatting",
            name: "ChatFormatting",
        });
    });

    it("uses the inner simple name for a nested class", () => {
        expect(parseReferenceTarget("a/b/Outer$Inner").name).toBe("Inner");
    });

    it("parses a method reference key", () => {
        expect(parseReferenceTarget("a/B:foo:(I)V")).toEqual({
            kind: "method",
            className: "a/B",
            name: "foo",
            descriptor: "(I)V",
        });
    });

    it("parses a field reference key", () => {
        expect(parseReferenceTarget("a/B:bar:Z")).toEqual({
            kind: "field",
            className: "a/B",
            name: "bar",
            descriptor: undefined,
        });
    });
});

describe("findReferenceSites", () => {
    const source = "void m() { a.foo(); b.foo(); }";
    const identifiers = collectIdentifiers(treeOf([
        { type: "identifier", text: "m" },
        { type: "identifier", text: "a" },
        { type: "identifier", text: "foo" },
        { type: "identifier", text: "b" },
        { type: "identifier", text: "foo" },
    ], source), []);

    const [m, a, firstFoo, b, secondFoo] = identifiers;

    it("keeps only the call the resolved tokens point at", () => {
        // Only b.foo() is resolved as B.foo; a.foo() must not be reported.
        const resolved = [
            methodToken(m.start, m.length, "x/Caller", "m", "()V"),
            methodToken(b.start, b.length, "a/B", "b", "La/B;"),
            methodToken(secondFoo.start, secondFoo.length, "a/B", "foo", "()V"),
        ];

        const target: ReferenceTarget = { kind: "method", className: "a/B", name: "foo", descriptor: "()V" };
        expect(sites(identifiers, resolved, target)).toEqual([secondFoo.start]);
    });

    it("does not confuse same-named members of different classes", () => {
        const resolved = [
            methodToken(firstFoo.start, firstFoo.length, "a/Other", "foo", "()V"),
            methodToken(secondFoo.start, secondFoo.length, "a/B", "foo", "()V"),
        ];

        const target: ReferenceTarget = { kind: "method", className: "a/B", name: "foo", descriptor: "()V" };
        const found = sites(identifiers, resolved, target);
        expect(found).toEqual([secondFoo.start]);
        expect(found).not.toContain(firstFoo.start);
    });

    it("requires the descriptor to match for methods", () => {
        const resolved = [methodToken(firstFoo.start, firstFoo.length, "a/B", "foo", "(I)V")];

        expect(sites(identifiers, resolved, { kind: "method", className: "a/B", name: "foo", descriptor: "()V" })).toEqual([]);
        expect(sites(identifiers, resolved, { kind: "method", className: "a/B", name: "foo", descriptor: "(I)V" })).toEqual([firstFoo.start]);
    });

    it("matches field references by owner and name", () => {
        const source2 = "a.BAR";
        const ids = collectIdentifiers(treeOf([
            { type: "identifier", text: "a" },
            { type: "identifier", text: "BAR" },
        ], source2), []);
        const resolved = [fieldToken(ids[1].start, ids[1].length, "a/B", "BAR", "Z")];

        expect(sites(ids, resolved, { kind: "field", className: "a/B", name: "BAR" })).toEqual([ids[1].start]);
    });

    it("matches class references by simple name", () => {
        const source3 = "StringRepresentable.fromEnum()";
        const ids = collectIdentifiers(treeOf([
            { type: "type_identifier", text: "StringRepresentable" },
            { type: "identifier", text: "fromEnum" },
        ], source3), []);
        const resolved = [{ ...methodToken(ids[0].start, ids[0].length, "net/minecraft/StringRepresentable", "StringRepresentable", "Lnet/minecraft/StringRepresentable;"), type: "class" as const }];

        const target: ReferenceTarget = { kind: "class", className: "net/minecraft/StringRepresentable", name: "StringRepresentable" };
        expect(sites(ids, resolved, target)).toEqual([ids[0].start]);
    });

    it("reports nothing when no resolved token matches", () => {
        const resolved = [methodToken(m.start, m.length, "x/Caller", "m", "()V")];

        expect(sites(identifiers, resolved, { kind: "method", className: "a/B", name: "foo", descriptor: "()V" })).toEqual([]);
    });

    it("still finds references when the resolved span is offset from the identifier", () => {
        const source4 = "LevelRenderer.x";
        const ids = collectIdentifiers(treeOf([
            { type: "identifier", text: "LevelRenderer" },
            { type: "identifier", text: "x" },
        ], source4), []);
        // Vineflower reported only the simple name inside the identifier.
        const resolved = [methodToken(5, 8, "a/B", "Renderer", "()V")];

        expect(sites(ids, resolved, { kind: "method", className: "a/B", name: "Renderer", descriptor: "()V" })).toEqual([0]);
    });
});

describe("collectStrings", () => {
    it("collects a simple literal without its quotes", () => {
        const source = 'String a = "hello";';
        const literal = leaves([{ type: "string_literal", text: '"hello"' }], source)[0];
        const root = node("program", [literal], 0, source.length);

        const strings = collectStrings(root);
        expect(strings).toHaveLength(1);
        expect(strings[0].text).toBe("hello");
        expect(strings[0].start).toBe(source.indexOf('"hello"'));
    });

    it("joins the fragments tree-sitter splits an escaped literal into", () => {
        // The literal as written in the source: "tab\there"
        const raw = '"tab\\there"';
        const source = `String a = ${raw};`;
        const literalStart = source.indexOf(raw);

        // tree-sitter splits it at the escape, so the fragments are not contiguous.
        const joinFragments = (literalSource: string, fragments: string[]): SyntaxNodeLike => {
            let at = 0;
            const children = fragments.map(text => {
                const index = literalSource.indexOf(text, at);
                at = index + text.length;
                return {
                    type: "string_fragment",
                    text,
                    startIndex: literalStart + index,
                    endIndex: literalStart + index + text.length,
                    childCount: 0,
                    child: () => null,
                } satisfies SyntaxNodeLike;
            });

            return node("string_literal", children, literalStart, literalStart + literalSource.length);
        };

        const literal = joinFragments(raw, ["tab", "here"]);
        const root = node("program", [literal], 0, source.length);

        // The tab escape itself is not part of either fragment, so the joined content is
        // "tabhere"; what matters is that the fragments are combined rather than dropped.
        expect(collectStrings(root)[0].text).toBe("tabhere");
    });

    it("collects an empty literal", () => {
        const source = 'String a = "";';
        const literal = leaves([{ type: "string_literal", text: '""' }], source)[0];
        const root = node("program", [literal], 0, source.length);

        expect(collectStrings(root)[0].text).toBe("");
    });

    it("finds literals nested inside expressions", () => {
        const source = 'log("first", "second");';
        const children = leaves([
            { type: "identifier", text: "log" },
            { type: "string_literal", text: '"first"' },
            { type: "string_literal", text: '"second"' },
        ], source);
        const root = node("program", children, 0, source.length);

        expect(collectStrings(root).map(s => s.text)).toEqual(["first", "second"]);
    });

    it("ignores character literals", () => {
        const source = "char c = 'x';";
        const root = node("program", leaves([{ type: "character_literal", text: "'x'" }], source), 0, source.length);

        expect(collectStrings(root)).toEqual([]);
    });

    it("returns literals ordered by position", () => {
        const source = '"a" "b" "c"';
        const c = leaves([
            { type: "string_literal", text: '"a"' },
            { type: "string_literal", text: '"b"' },
            { type: "string_literal", text: '"c"' },
        ], source);
        const root = node("program", [c[2], c[0], c[1]], 0, source.length);

        expect(collectStrings(root).map(s => s.text)).toEqual(["a", "b", "c"]);
    });
});

describe("unquoteLiteral", () => {
    it("strips surrounding quotes", () => {
        expect(unquoteLiteral('"hello"')).toBe("hello");
    });

    it("leaves unquoted text alone", () => {
        expect(unquoteLiteral("hello")).toBe("hello");
    });

    it("handles an empty literal", () => {
        expect(unquoteLiteral('""')).toBe("");
    });
});
