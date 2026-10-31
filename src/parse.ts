import type { Piece } from 'muggle-string';
import pugLex from 'pug-lexer';
import { Lines } from './lines';

const pugParser = require('pug-parser');

export interface PugError {
	code: string;
	msg: string;
	/** 0-based. */
	line: number;
	/** 0-based. */
	column: number;
	filename: string;
}

export interface PugParseResult {
	/**
	 * The HTML, as new text and ranges of the pug code. `text` is HTML that maps to its range as a whole, such as `class`
	 * for the `.` of `.foo`, or the closing quote that pug adds to a value (an empty range).
	 */
	pieces: Piece[];
	/** The pug AST, with 1-based lines and columns of the pug code. */
	ast: Node | undefined;
	error: PugError | undefined;
}

const filename = 'file.pug';
const lineStartTokens = new Set(['newline', 'indent', 'outdent', ':']);

/**
 * Compiles pug to HTML pieces, which map to the pug code.
 *
 * Vue dedents a pug template (`dedent` of `@vue/compiler-sfc`), but pug reads an indented first line as text, so the
 * code is lexed dedented and the columns of its tokens are moved back by the indent.
 */
export function parse(pugCode: string): PugParseResult {
	const lines = new Lines(pugCode);
	const indent = minIndent(pugCode);
	const pieces: Piece[] = [];
	let tokens: pugLex.Token[];
	let ast: Node | undefined;

	try {
		tokens = pugLex(indent ? pugCode.replace(new RegExp(`^[^\\S\\r\\n]{0,${indent}}`, 'gm'), '') : pugCode, { filename });
	}
	catch (e) {
		return failed(e as PugError, indent);
	}
	for (const { loc } of tokens) {
		loc.start.column += indent;
		loc.end.column += indent;
	}
	const startTags = collectStartTags(tokens);
	try {
		ast = pugParser(tokens, { filename, src: pugCode }) as Node;
	}
	catch (e) {
		return failed(e as PugError, 0);
	}
	visit(ast, undefined);
	emit(copy('', pugCode.trimEnd().length));

	return { pieces, ast, error: undefined };

	function failed(error: PugError, columnOffset: number): PugParseResult {
		const line = error.line - 1;
		const column = offsetAt({ line: error.line, column: error.column + columnOffset }) - lines.offsetAt(line, 0);
		return { pieces: [], ast: undefined, error: { ...error, line, column } };
	}

	function emit(piece: Piece) {
		if (typeof piece === 'string') {
			const last = pieces.length - 1;
			if (typeof pieces[last] === 'string') {
				pieces[last] += piece;
			}
			else if (piece) {
				pieces.push(piece);
			}
		}
		else {
			pieces.push(piece);
		}
	}

	/** `text` that maps to `start`..`end` of the pug code; a copy of them carries no text. */
	function copy(text: string, start: number, end = start + text.length): Piece {
		return text === pugCode.slice(start, end) ? { start, end } : { start, end, text };
	}

	function offsetAt({ line, column }: { line: number; column: number }) {
		return lines.offsetAt(line - 1, column - 1);
	}

	function visit(node: Node, next: Node | undefined) {
		if (node.type === 'Block') {
			for (let i = 0; i < node.nodes.length; i++) {
				visit(node.nodes[i]!, node.nodes[i + 1]);
			}
		}
		else if (node.type === 'Mixin') {
			if (node.block) {
				visit(node.block, undefined);
			}
		}
		else if (node.type === 'Tag') {
			const start = offsetAt(node);
			const startTag = startTags.get(start);
			const selfClosing = node.block.nodes.length === 0;
			let startTagEnd = start;
			emit(copy('', start));
			emit('<');
			if (pugCode.startsWith(node.name, start)) {
				emit(copy(node.name, start));
				startTagEnd += node.name.length;
			}
			else {
				emit(node.name);
			}
			if (startTag) {
				startTag.pieces.forEach(emit);
				startTagEnd = Math.max(startTagEnd, startTag.end);
			}
			if (selfClosing) {
				emit(' />');
				emit(copy('', startTagEnd));
			}
			else {
				emit('>');
				visit(node.block, undefined);
				if (next) {
					emit(copy('', offsetAt({ line: next.line, column: next.type === 'Block' ? 1 : next.column })));
				}
				emit(`</${node.name}>`);
				emit(copy('', start));
			}
		}
		else if (node.type === 'Text') {
			emit(copy(node.val, offsetAt(node)));
		}
	}

	/**
	 * The attributes of the start tags by the offsets of the tags, in the order of the code: a class or id of `.foo` or
	 * `#foo`, and the code of an attribute block, whose commas are line ends and whose template literal values are
	 * quoted, to read as HTML attributes of the same length.
	 */
	function collectStartTags(tokens: pugLex.Token[]) {
		const startTags = new Map<number, { pieces: Piece[]; end: number }>();
		let tagStart = 0;

		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i]!;
			const prevToken = tokens[i - 1];
			if (token.type === 'tag' || !prevToken || lineStartTokens.has(prevToken.type)) {
				tagStart = offsetAt(token.loc.start);
			}
			if (token.type !== 'class' && token.type !== 'id' && token.type !== 'start-attributes') {
				continue;
			}
			let startTag = startTags.get(tagStart);
			if (!startTag) {
				startTags.set(tagStart, startTag = { pieces: [], end: tagStart });
			}
			if (token.type === 'start-attributes') {
				const start = offsetAt(token.loc.end);
				let text = '';
				let end = start;
				for (i++; i < tokens.length; i++) {
					const attrToken = tokens[i]!;
					const attrStart = offsetAt(attrToken.loc.start);
					text += pugCode.slice(end, attrStart).replace(/,/g, '\n');
					end = offsetAt(attrToken.loc.end);
					if (attrToken.type !== 'attribute') {
						break;
					}
					text += attributeHTML(pugCode.slice(attrStart, end), attrToken.val);
				}
				startTag.pieces.push(' ', copy(text, start));
				startTag.end = Math.max(startTag.end, end);
			}
			else {
				// `'foo'` of `.foo`: the opening quote is the `.`, and the closing quote has no source
				const start = offsetAt(token.loc.start);
				const end = start + 1 + token.val.length;
				startTag.pieces.push(' ', { start, end: start + 1, text: token.type }, '=', copy(`'${token.val}`, start, end), {
					start: end,
					end,
					text: "'",
				});
				startTag.end = Math.max(startTag.end, end);
			}
		}

		return startTags;
	}
}

/** `code` of an attribute as HTML: a template literal value quoted, and a ` \` line continuation a comment. */
function attributeHTML(code: string, val: string | boolean) {
	if (typeof val !== 'string' || !code.includes('=')) {
		return code;
	}
	// the lexer reads the code with `\n` line ends, so the value is the end of the code with `\r\n` as one char
	let valStart = code.length;
	for (let n = val.length; n > 0; n--) {
		valStart--;
		if (code[valStart] === '\n' && code[valStart - 1] === '\r') {
			valStart--;
		}
	}
	let valCode = code.slice(valStart);
	if (valCode.startsWith('`') && valCode.endsWith('`')) {
		const inner = valCode.slice(1, -1);
		valCode = !inner.includes('"')
			? `"${inner}"`
			: !inner.includes("'")
			? `'${inner}'`
			: `'${inner.replace(/'/g, '"')}'`;
	}
	return code.slice(0, valStart) + valCode.replace(/ \\(?=\r?\n)/g, '//');
}

function minIndent(code: string) {
	let min = Infinity;
	for (const line of code.split('\n')) {
		if (line.trim() !== '') {
			min = Math.min(min, line.match(/^\s*/)![0].length);
		}
	}
	return min === Infinity ? 0 : min;
}

export type Node = BlockNode | MixinNode | TagNode | TextNode | CommentNode | BlockCommentNode;

export interface BlockNode {
	type: 'Block';
	nodes: Node[];
	line: number;
}

export interface TagNode {
	type: 'Tag';
	name: string;
	selfClosing: boolean;
	block: BlockNode;
	attrs: {
		name: string;
		val: string | true;
		line: number;
		column: number;
		mustEscape: boolean;
	}[];
	attributeBlocks: {
		// ?
	}[];
	isInline: boolean;
	line: number;
	column: number;
}

export interface TextNode {
	type: 'Text';
	val: string;
	line: number;
	column: number;
}

export interface CommentNode {
	type: 'Comment';
	val: string;
	buffer: boolean;
	line: number;
	column: number;
}

export interface BlockCommentNode {
	type: 'BlockComment';
	block: BlockNode;
	val: string;
	buffer: boolean;
	line: number;
	column: number;
}

export interface MixinNode {
	type: 'Mixin';
	name: string;
	args: null;
	block: BlockNode | null;
	line: number;
	column: number;
}
