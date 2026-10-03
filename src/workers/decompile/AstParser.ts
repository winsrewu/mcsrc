import { Parser, Language } from "web-tree-sitter";
// Vite resolves these to asset URLs, so no postinstall copy into public/ is needed.
import treeSitterWasm from "web-tree-sitter/web-tree-sitter.wasm?url";
import javaGrammarWasm from "tree-sitter-java/tree-sitter-java.wasm?url";
import { collectIdentifiers, type AstToken, type SyntaxNodeLike } from "../../logic/AstSearch";
import type { Token } from "../../logic/Tokens";

let parserPromise: Promise<Parser> | undefined;

async function createParser(): Promise<Parser> {
    await Parser.init({
        locateFile(scriptName: string) {
            return scriptName.endsWith(".wasm") ? treeSitterWasm : scriptName;
        },
    });

    const language = await Language.load(javaGrammarWasm);

    const parser = new Parser();
    parser.setLanguage(language);
    return parser;
}

function getParser(): Promise<Parser> {
    parserPromise ??= createParser();
    return parserPromise;
}

/** Parses decompiled Java source and returns every identifier token tree-sitter found. */
export async function extractIdentifiers(source: string, covered: readonly Token[]): Promise<AstToken[]> {
    const parser = await getParser();
    const tree = parser.parse(source);

    if (!tree) {
        return [];
    }

    try {
        return collectIdentifiers(tree.rootNode as unknown as SyntaxNodeLike, covered);
    } finally {
        tree.delete();
    }
}
