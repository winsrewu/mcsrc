import { Parser, Language } from "web-tree-sitter";
// Vite resolves these to asset URLs, so no postinstall copy into public/ is needed.
import treeSitterWasm from "web-tree-sitter/web-tree-sitter.wasm?url";
import javaGrammarWasm from "tree-sitter-java/tree-sitter-java.wasm?url";
import { collectIdentifiers, collectStrings, type AstString, type AstToken, type SyntaxNodeLike } from "../../logic/AstSearch";
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
    return withTree(source, root => collectIdentifiers(root, covered));
}

/** Parses decompiled Java source and returns every string literal tree-sitter found. */
export async function extractStrings(source: string): Promise<AstString[]> {
    return withTree(source, root => collectStrings(root));
}

/** Parses once and hands the root node to `collect`, always releasing the tree. */
async function withTree<T>(source: string, collect: (root: SyntaxNodeLike) => T): Promise<T> {
    const parser = await getParser();
    const tree = parser.parse(source);

    if (!tree) {
        throw new Error("tree-sitter failed to parse the decompiled source");
    }

    try {
        return collect(tree.rootNode as unknown as SyntaxNodeLike);
    } finally {
        tree.delete();
    }
}
