import type { DecompileResult } from "../workers/decompile/types.ts";
import type { ClassName } from "../utils/Names";

export type TokenType = 'class' | 'field' | 'method' | 'parameter' | 'local';

interface BaseToken {
    // The number of characters from the start of the source
    start: number;
    // The length of the token in characters
    length: number;
    // The name of the class this token represents
    className: ClassName;
    // Whether this token is a declaration or a reference
    declaration: boolean;
}

export interface MemberToken extends BaseToken {
    type: 'field' | 'method';
    // The member name
    name: string;
    // The member descriptor
    descriptor: string;
}

interface NonMethodToken extends BaseToken {
    type: 'class' | 'parameter' | 'local';
}

export type Token = MemberToken | NonMethodToken;

export interface TokenLocation {
    line: number,
    column: number;
    length: number;
}

/** The 1-based line and column of an offset, matching how Monaco counts positions. */
export function locationOf(source: string, start: number, length: number): TokenLocation {
    let line = 1;
    let lineStart = 0;

    for (let i = source.indexOf("\n"); i !== -1 && i < start; i = source.indexOf("\n", i + 1)) {
        line++;
        lineStart = i + 1;
    }

    return { line, column: start - lineStart + 1, length };
}

export function getTokenLocation(result: DecompileResult, token: Token): TokenLocation {
    return locationOf(result.source, token.start, token.length);
}
