declare module 'pug-parser' {
	import type { Token } from 'pug-lexer';

	function parse(tokens: Token[], options?: { filename?: string; src?: string }): unknown;
	export = parse;
}
