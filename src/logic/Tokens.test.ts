import { describe, it, expect } from "vitest";
import { getTokenLocation, locationOf } from "./Tokens";
import type { DecompileResult } from "../workers/decompile/types";
import type { ClassName } from "../utils/Names";

const source = 'line one\nline two\nString a = "EXAMPLE";';

function result(sourceText: string): DecompileResult {
    return {
        className: "a/B" as ClassName,
        checksum: 0,
        jarName: "test",
        source: sourceText,
        tokens: [],
        language: "java",
        version: "1.12.0",
    };
}

describe("locationOf", () => {
    it("reports a 1-based line and column on the first line", () => {
        expect(locationOf(source, 0, 4)).toEqual({ line: 1, column: 1, length: 4 });
    });

    it("counts columns from the start of their own line", () => {
        const start = source.indexOf("line two");
        expect(locationOf(source, start, 8)).toEqual({ line: 2, column: 1, length: 8 });
    });

    it("points at a literal's own line and column", () => {
        const start = source.indexOf("EXAMPLE");
        expect(locationOf(source, start, 7)).toEqual({ line: 3, column: 13, length: 7 });
    });

    it("handles the last line without a trailing newline", () => {
        expect(locationOf("a\nb", 2, 1)).toEqual({ line: 2, column: 1, length: 1 });
    });

    it("handles an empty source", () => {
        expect(locationOf("", 0, 0)).toEqual({ line: 1, column: 1, length: 0 });
    });
});

describe("getTokenLocation", () => {
    it("locates a token on a later line", () => {
        const start = source.indexOf("EXAMPLE");
        const location = getTokenLocation(result(source), {
            type: "class",
            start,
            length: 7,
            className: "a/B" as ClassName,
            declaration: false,
        });

        // Previously the column was computed from the absolute offset, so a token on
        // line 3 previously reported column 18 instead of its real position.
        expect(location).toEqual({ line: 3, column: 13, length: 7 });
    });

    it("locates a token at the very start of the source", () => {
        const location = getTokenLocation(result(source), {
            type: "class",
            start: 0,
            length: 4,
            className: "a/B" as ClassName,
            declaration: false,
        });

        expect(location).toEqual({ line: 1, column: 1, length: 4 });
    });
});
