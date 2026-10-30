import pugLex from 'pug-lexer';
import { Lines } from './lines';

const pugParser = require('pug-parser');

/**
 * Generated HTML: plain text, or text copied from `sourceOffset` of the pug code, whose source range is `sourceLength`
 * chars long. A source length that differs from the text is of a char that pug adds, such as the closing quote of
 * the value of `.foo`.
 */
export type PugSegment = string | [text: string, source: undefined, sourceOffset: number, sourceLength: number];

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
	/** The HTML of the segments. */
	htmlCode: string;
	segments: PugSegment[];
	/** The pug AST, with 1-based lines and columns of the pug code. */
	ast: Node | undefined;
	error: PugError | undefined;
	/** The offsets of the line ends of the empty lines that the pug code has before a line. */
	emptyLineEnds: number[];
}

const indentedPrefix = 'template\n';
const startTagLength = '<template>'.length;
const endTagLength = '</template>'.length;

/**
 * Compiles pug to HTML segments, which map to the pug code.
 *
 * Vue dedents a pug template (`dedent` of `@vue/compiler-sfc`), but pug reads an indented first line as an
 * error, so an indented template is parsed as the children of a `template` tag. The tag is blanked out of
 * the HTML and left out of the mapped segments, the AST and the offsets, which are all of `pugCode`.
 */
export function parse(pugCode: string): PugParseResult {
	if (calculateMinIndent(pugCode) === 0) {
		return parseCode(pugCode);
	}
	const parsed = parseCode(indentedPrefix + pugCode);
	const prefixLength = indentedPrefix.length;
	return {
		...blankTemplateTag(parsed.segments, parsed.htmlCode.length, prefixLength),
		error: parsed.error && { ...parsed.error, line: parsed.error.line - 1 },
		ast: parsed.ast && toPrevLine(((parsed.ast as BlockNode).nodes[0] as TagNode).block),
		emptyLineEnds: parsed.emptyLineEnds.map(offset => offset - prefixLength),
	};
}

/** Blanks the tags of the `template` around the HTML, and shifts the segments that map past the prefix. */
function blankTemplateTag(segments: PugSegment[], htmlLength: number, prefixLength: number) {
	if (htmlLength < startTagLength + endTagLength) {
		const htmlCode = ' '.repeat(startTagLength + endTagLength);
		return { htmlCode, segments: [htmlCode] };
	}
	const endTagStart = htmlLength - endTagLength;
	const result: PugSegment[] = [];
	let offset = 0;
	for (const segment of segments) {
		const text = typeof segment === 'string' ? segment : segment[0];
		const start = offset;
		offset += text.length;
		let blanked = text;
		if (start < startTagLength || offset > endTagStart) {
			blanked = '';
			for (let i = 0; i < text.length; i++) {
				const at = start + i;
				blanked += at < startTagLength || at >= endTagStart ? ' ' : text[i];
			}
		}
		if (typeof segment === 'string' || segment[2] < prefixLength) {
			result.push(blanked);
		}
		else {
			result.push([blanked, undefined, segment[2] - prefixLength, segment[3]]);
		}
	}
	return { htmlCode: toString(result), segments: result };
}

function toString(segments: PugSegment[]) {
	return segments.map(segment => typeof segment === 'string' ? segment : segment[0]).join('');
}

function mapped(text: string, offset: number, sourceLength = text.length): PugSegment {
	return [text, undefined, offset, sourceLength];
}

function calculateMinIndent(s: string) {
	const lines = s.split('\n');
	const minIndent = lines.reduce(function(minIndent, line) {
		if (line.trim() === '') {
			return minIndent;
		}
		const indent = line.match(/^\s*/)?.[0]?.length || 0;
		return Math.min(indent, minIndent);
	}, Infinity);
	return minIndent;
}

function toPrevLine<T extends object>(node: T): T {
	const visited = new Set<object>();
	visit(node);
	return node;

	function visit(obj: object) {
		if (visited.has(obj)) {
			return;
		}
		visited.add(obj);
		if ('line' in obj && typeof obj.line === 'number') {
			obj.line--;
		}
		for (const value of Object.values(obj)) {
			if (value && typeof value === 'object') {
				visit(value);
			}
		}
	}
}

function parseCode(pugCode: string): PugParseResult {
	const fileName = 'file.pug';
	const lines = new Lines(pugCode);
	const codes: PugSegment[] = [];
	let error: PugError | undefined;
	let emptyLineEnds: ReturnType<typeof collectEmptyLineEnds> = [];
	let attrsBlocks: ReturnType<typeof collectAttrsBlocks>;
	let ast: Node | undefined;

	try {
		const tokens = pugLex(pugCode, { filename: fileName });

		emptyLineEnds = collectEmptyLineEnds(tokens);
		attrsBlocks = collectAttrsBlocks(tokens);
		ast = pugParser(tokens, { filename: fileName, src: pugCode }) as Node;

		visitNode(ast, undefined, undefined);

		codes.push(mapped('', pugCode.trimEnd().length));
	}
	catch (e) {
		const _error = e as NonNullable<typeof error>;
		error = {
			..._error,
			line: _error.line - 1,
			column: _error.column - 1,
		};
	}

	return {
		htmlCode: toString(codes),
		segments: codes,
		error,
		ast,
		emptyLineEnds,
	};

	function visitNode(node: Node, next: Node | undefined, parent: Node | undefined) {
		if (node.type === 'Block') {
			for (let i = 0; i < node.nodes.length; i++) {
				visitNode(node.nodes[i]!, node.nodes[i + 1], node);
			}
		}
		else if (node.type === 'Mixin') {
			if (node.block) {
				visitNode(node.block, undefined, node);
			}
		}
		else if (node.type === 'Tag') {
			const pugTagRange = getDocRange(node.line, node.column, node.name.length);

			codes.push(mapped('', pugTagRange.start));

			const selfClosing = node.block.nodes.length === 0;
			const startTagEnd = addStartTag(node, selfClosing);
			if (!selfClosing) {
				visitNode(node.block, next, parent);
				addEndTag(node, next, parent);
			}
			codes.push(mapped('', selfClosing ? startTagEnd : pugTagRange.start));
		}
		else if (node.type === 'Text') {
			codes.push(mapped(node.val, getDocOffset(node.line, node.column)));
		}
	}

	/** Returns the end of the start tag in the pug code. */
	function addStartTag(node: TagNode, selfClosing: boolean) {
		codes.push(mapped('', getDocOffset(node.line, node.column)));
		codes.push('<');
		const tagRange = getDocRange(node.line, node.column, node.name.length);
		let end = tagRange.start;
		if (pugCode.substring(tagRange.start, tagRange.end) === node.name) {
			codes.push(mapped(node.name, tagRange.start));
			end = tagRange.end;
		}
		else {
			codes.push(node.name);
		}

		for (const attr of node.attrs.filter(attr => !attr.mustEscape)) {
			codes.push(' ');
			if (attr.name === 'class' || attr.name === 'id') {
				const offset = getDocOffset(attr.line, attr.column);
				for (const char of attr.name) {
					codes.push(mapped(char, offset));
				}
			}
			else {
				codes.push(attr.name);
			}
			if (typeof attr.val !== 'boolean') {
				codes.push('=');
				const offset = getDocOffset(attr.line, attr.column);
				const literalName = attr.val.slice(1, -1);
				if (
					(attr.name === 'class' || attr.name === 'id')
					&& pugCode.slice(offset + 1, offset + 1 + literalName.length) === literalName
				) {
					// `'foo'` of `.foo`: the opening quote is the `.`, and the closing quote has no source
					codes.push(mapped(attr.val.slice(0, -1), offset));
					codes.push(mapped(attr.val.slice(-1), offset + 1 + literalName.length, 0));
					end = Math.max(end, offset + 1 + literalName.length);
				}
				else {
					codes.push(mapped(attr.val, offset));
				}
			}
		}

		const attrsBlock = attrsBlocks.get(getDocOffset(node.line, node.column)); // support attr auto-complete in spaces
		if (attrsBlock) {
			codes.push(' ');
			codes.push(mapped(attrsBlock.text, attrsBlock.offset));
			end = Math.max(end, attrsBlock.end);
		}

		if (selfClosing) {
			codes.push(' />');
		}
		else {
			codes.push('>');
		}
		return end;
	}

	function addEndTag(node: TagNode, next: Node | undefined, parent: Node | undefined) {
		let nextStart: number | undefined;
		if (next) {
			if (next.type === 'Block') {
				nextStart = getDocOffset(next.line, 1);
			}
			else {
				nextStart = getDocOffset(next.line, next.column);
			}
		}
		else if (!parent) {
			nextStart = pugCode.length;
		}
		if (nextStart !== undefined) {
			codes.push(mapped('', nextStart));
		}
		codes.push(`</${node.name}>`);
	}

	function collectEmptyLineEnds(tokens: pugLex.Token[]) {
		const ends: number[] = [];

		for (const token of tokens) {
			if (token.type === 'newline' || token.type === 'outdent') {
				let currentLine = token.loc.start.line - 2;
				let prevLine = lines.lineText(currentLine);
				while (prevLine.trim() === '') {
					ends.push(lines.offsetAt(currentLine + 1, 0) - 1);
					if (currentLine <= 0) {
						break;
					}
					currentLine--;
					prevLine = lines.lineText(currentLine);
				}
			}
		}

		return ends.sort((a, b) => a - b);
	}

	function collectAttrsBlocks(tokens: pugLex.Token[]) {
		const blocks = new Map<number, { offset: number; end: number; text: string }>();

		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i]!;
			if (token.type === 'start-attributes') {
				let tagStart: pugLex.Token = token;

				for (let j = i - 1; j >= 0; j--) {
					const prevToken = tokens[j]!;

					if (
						prevToken.type === 'newline'
						|| prevToken.type === 'indent'
						|| prevToken.type === 'outdent'
						|| prevToken.type === ':'
					) {
						break;
					}

					tagStart = prevToken;

					if (prevToken.type === 'tag') {
						break;
					}
				}

				let prevToken: pugLex.Token = token;
				let text = '';

				for (i++; i < tokens.length; i++) {
					const attrToken = tokens[i]!;
					addPrevSpace(attrToken);

					if (attrToken.type === 'attribute') {
						let attrText = pugCode.substring(
							getDocOffset(attrToken.loc.start.line, attrToken.loc.start.column),
							getDocOffset(attrToken.loc.end.line, attrToken.loc.end.column),
						);
						if (typeof attrToken.val === 'string' && attrText.includes('=')) {
							// the lexer reads the code with `\n` line ends, so the value is found in that text and read from the code
							const valStart = toCodeIndex(
								attrText,
								attrText.replace(/\r\n?/g, '\n').lastIndexOf(attrToken.val),
							);
							let valText = attrText.slice(valStart);
							if (valText.startsWith('`') && valText.endsWith('`')) {
								const innerContent = valText.slice(1, -1);
								if (!innerContent.includes('"')) {
									valText = `"${innerContent}"`;
								}
								else if (!innerContent.includes("'")) {
									valText = `'${innerContent}'`;
								}
								else {
									// Both quote types present: convert inner single quotes to double quotes
									// This allows using single quotes as the outer delimiter
									// JavaScript accepts both 'str' and "str" for string literals
									valText = `'${innerContent.replace(/'/g, '"')}'`;
								}
							}
							valText = valText.replace(/ \\(?=\r?\n)/g, '//');
							text += attrText.slice(0, valStart) + valText;
						}
						else {
							text += attrText;
						}
					}
					else if (attrToken.type === 'end-attributes') {
						blocks.set(getDocOffset(tagStart.loc.start.line, tagStart.loc.start.column), {
							offset: getDocOffset(token.loc.end.line, token.loc.end.column),
							end: getDocOffset(attrToken.loc.end.line, attrToken.loc.end.column),
							text,
						});
						break;
					}

					prevToken = attrToken;
				}

				function addPrevSpace(currentToken: pugLex.Token) {
					text += pugCode.substring(
						getDocOffset(prevToken.loc.end.line, prevToken.loc.end.column),
						getDocOffset(currentToken.loc.start.line, currentToken.loc.start.column),
					).replace(/,/g, '\n');
				}
			}
		}

		return blocks;
	}

	function getDocOffset(pugLine: number, pugColumn: number) {
		return lines.offsetAt(pugLine - 1, pugColumn - 1);
	}

	function getDocRange(pugLine: number, pugColumn: number, length: number) {
		const start = getDocOffset(pugLine, pugColumn);
		const end = start + length;
		return {
			start,
			end,
		};
	}
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

/** The index in `code` of `index` in `code` with `\n` line ends. */
function toCodeIndex(code: string, index: number) {
	let codeIndex = 0;
	for (let i = 0; i < index; i++) {
		if (code[codeIndex] === '\r' && code[codeIndex + 1] === '\n') {
			codeIndex++;
		}
		codeIndex++;
	}
	return codeIndex;
}
