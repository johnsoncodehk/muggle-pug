declare module 'pug-parser' {
	import type { Token } from 'pug-lexer';

	/** Returns the AST of `src/ast.ts`. */
	function parse(tokens: Token[], options?: { filename?: string; src?: string }): unknown;
	export default parse;
}
