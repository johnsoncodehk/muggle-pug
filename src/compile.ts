import type { Piece } from 'muggle-string';
import lex from 'pug-lexer';
import parse from 'pug-parser';
import type { Attribute, Block, BlockComment, Comment, Node, Tag, Text } from './ast.js';

export interface CompileResult {
	/**
	 * The HTML, as ranges of the template. A range without `text` keeps the template text at `start`..`end`; a range
	 * with `text` is HTML that stands for `start`..`end`, such as `<` at the start of a tag, `>` and `</div>` at the
	 * end of its head and of the element, or `"` in place of the `.` of a class literal.
	 */
	pieces: Piece[];
	/**
	 * The AST of pug-parser for the template, with the lines that pug fails on left empty (see `error`). Lines and
	 * columns are pug's: 1-based, in the template as given.
	 */
	ast: Block;
	/**
	 * The first error that pug reports for the template. The lines it fails on are left empty, one at a time, until
	 * pug accepts the rest, so `pieces` and `ast` still cover the other lines.
	 */
	error: CompileError | undefined;
}

export interface CompileError {
	/** pug's code, such as `PUG:NO_END_BRACKET`, or the code or name of another error that pug throws, such as `TypeError`. */
	code: string;
	/** pug's message, without its code frame. */
	message: string;
	/** Where pug reports the error, as an offset of the template; where it stops, for an error without a position. */
	offset: number;
	/** The 0-based line of `offset`. */
	line: number;
	/** The 0-based column of `offset`, in UTF-16 code units. */
	column: number;
}

interface Lines {
	/** The offset of the first char of each line; the first line starts after a byte order mark. */
	starts: number[];
	/** The offset of the end of each line, before its line break. */
	ends: number[];
	/** The length of the spaces and tabs at the start of each line. */
	indents: number[];
}

interface Emitter {
	source: string;
	lines: Lines;
	/** The end of the source text that starts at an offset: of a text, an attribute, or the head of a tag. */
	ends: Map<number, number>;
	pieces: Piece[];
}

/** pug's error, with a 1-based line and column. */
interface PugError {
	code: string;
	msg: string;
	line: number;
	column: number;
}

/**
 * Compiles a pug template to HTML for tools, not as pug renders it: HTML that an HTML parser reads as the elements,
 * attributes, text and comments written in the template, each from the template text where it can be. Every markup
 * node is in the HTML once: conditionals, loops, mixins and code add the markup inside them without being evaluated,
 * and doctypes, includes, extends and filters add none.
 *
 * pug is given the template without the indentation that all its lines share, as Vue gives a pug template to pug.
 */
export function compile(source: string): CompileResult {
	const lines = scanLines(source);
	// the lines that pug is given empty: blank lines, and the lines that it fails on
	const emptied = new Uint8Array(lines.starts.length);
	let shared = Infinity;
	for (let i = 0; i < lines.starts.length; i++) {
		if (lines.indents[i] === lines.ends[i]! - lines.starts[i]!) {
			emptied[i] = 1;
		}
		else {
			shared = Math.min(shared, lines.indents[i]!);
		}
	}
	const shifts = lines.indents.map(indent => Math.min(indent, shared));
	let error: CompileError | undefined;

	while (true) {
		let input = '';
		for (let i = 0; i < lines.starts.length; i++) {
			if (i > 0) {
				input += '\n';
			}
			if (!emptied[i]) {
				input += source.slice(lines.starts[i]! + shifts[i]!, lines.ends[i]);
			}
		}

		const lexer = new lex.Lexer(input);
		let tokens: lex.Token[];
		try {
			tokens = lexer.getTokens();
		}
		catch (thrown) {
			// the token that failed starts after the last one lexed
			const last = lexer.tokens[lexer.tokens.length - 1]?.loc.end;
			const after = last ? offsetAt(lines, last.line, last.column + shifts[last.line - 1]!) : 0;
			error ??= toCompileError(source, lines, thrown, after, shifts);
			emptyLineAt(source, lines, emptied, after);
			continue;
		}

		const ends = new Map<number, number>();
		let head = -1;
		for (const token of tokens) {
			const { start, end } = token.loc;
			start.column += shifts[start.line - 1]!;
			end.column += shifts[end.line - 1]!;
			const startOffset = offsetAt(lines, start.line, start.column);
			const endOffset = offsetAt(lines, end.line, end.column);
			switch (token.type) {
				case 'tag':
				case 'call':
				case 'interpolation':
					head = startOffset;
					ends.set(head, endOffset);
					break;
				case 'class':
				case 'id':
					if (head === -1) {
						head = startOffset;
					}
					ends.set(head, endOffset);
					break;
				case 'attribute':
					ends.set(startOffset, endOffset);
					ends.set(head, endOffset);
					break;
				case 'start-attributes':
				case 'end-attributes':
				case '&attributes':
				case 'dot':
				case 'slash':
					ends.set(head, endOffset);
					break;
				case 'text':
				case 'text-html':
					ends.set(startOffset, endOffset);
					head = -1;
					break;
				default:
					head = -1;
			}
		}

		let ast: Block;
		try {
			ast = parse(tokens) as Block;
		}
		catch (thrown) {
			const parseError = toCompileError(source, lines, thrown, source.length);
			error ??= parseError;
			emptyLineAt(source, lines, emptied, parseError.offset);
			continue;
		}

		const emitter: Emitter = { source, lines, ends, pieces: [] };
		emitNodes(emitter, ast.nodes);
		return { pieces: emitter.pieces, ast, error };
	}
}

function scanLines(source: string): Lines {
	const lines: Lines = { starts: [], ends: [], indents: [] };
	let start = source.charCodeAt(0) === 0xFEFF ? 1 : 0;
	let indent = -1;
	for (let i = start; i <= source.length; i++) {
		const char = source.charCodeAt(i);
		if (indent === -1 && char !== 32 && char !== 9) {
			indent = i - start;
		}
		if (char === 10 || char === 13 || i === source.length) {
			lines.starts.push(start);
			lines.ends.push(i);
			lines.indents.push(indent);
			if (char === 13 && source.charCodeAt(i + 1) === 10) {
				i++;
			}
			start = i + 1;
			indent = -1;
		}
	}
	return lines;
}

/**
 * The error that pug throws, with its column in the template if it is in the input that is given to pug without
 * `shifts`. An error without a position, of a bug of pug, is at `at`.
 */
function toCompileError(source: string, lines: Lines, thrown: unknown, at: number, shifts?: number[]): CompileError {
	const pugError = thrown as Partial<PugError> | null;
	let offset = at;
	if (typeof pugError?.line === 'number' && typeof pugError.column === 'number') {
		offset = offsetAt(lines, pugError.line, pugError.column + (shifts?.[pugError.line - 1] ?? 0));
	}
	offset = Math.min(offset, source.length);
	let line = 0;
	while (line + 1 < lines.starts.length && lines.starts[line + 1]! <= offset) {
		line++;
	}
	return {
		code: typeof pugError?.code === 'string' ? pugError.code : (thrown as Error).name,
		message: typeof pugError?.msg === 'string' ? pugError.msg : (thrown as Error).message,
		offset,
		line,
		column: offset - lines.starts[line]!,
	};
}

/** The offset of a 1-based line and column of pug. */
function offsetAt(lines: Lines, line: number, column: number) {
	return lines.starts[Math.min(line, lines.starts.length) - 1]! + column - 1;
}

/**
 * Empties the line where pug failed at `offset`: the first line not empty at or after it, or, when only whitespace
 * follows, the last one before it. pug accepts a template of empty lines, so it accepts what is left in the end.
 */
function emptyLineAt(source: string, lines: Lines, emptied: Uint8Array, offset: number) {
	let line = 0;
	while (line + 1 < lines.starts.length && lines.starts[line + 1]! <= offset) {
		line++;
	}
	for (let i = line; i < lines.starts.length; i++) {
		if (!emptied[i] && (i > line || hasCode(source, offset, lines.ends[i]!))) {
			emptied[i] = 1;
			return;
		}
	}
	for (let i = line; i >= 0; i--) {
		if (!emptied[i]) {
			emptied[i] = 1;
			return;
		}
	}
}

function hasCode(source: string, from: number, to: number) {
	for (let i = from; i < to; i++) {
		const char = source.charCodeAt(i);
		if (char !== 32 && char !== 9) {
			return true;
		}
	}
	return false;
}

function emitNodes(emitter: Emitter, nodes: Node[]) {
	let end = -1;
	for (const node of nodes) {
		end = Math.max(end, emitNode(emitter, node));
	}
	return end;
}

/** Emits the HTML of `node`, and returns the end of its source text, or -1 if it has no HTML. */
function emitNode(emitter: Emitter, node: Node): number {
	switch (node.type) {
		case 'Block':
		case 'NamedBlock':
			return emitNodes(emitter, node.nodes);
		case 'Tag':
			return emitTag(emitter, node);
		case 'Text':
			return emitText(emitter, node);
		case 'Comment':
		case 'BlockComment':
			return emitComment(emitter, node);
		case 'Conditional':
			return Math.max(
				emitNodes(emitter, node.consequent.nodes),
				node.alternate ? emitNode(emitter, node.alternate) : -1,
			);
		case 'Each':
			return Math.max(
				emitNodes(emitter, node.block.nodes),
				node.alternate ? emitNodes(emitter, node.alternate.nodes) : -1,
			);
		case 'InterpolatedTag':
		case 'Case':
		case 'EachOf':
		case 'While':
		case 'When':
		case 'Code':
		case 'Mixin':
			return node.block ? emitNodes(emitter, node.block.nodes) : -1;
		case 'Doctype':
		case 'MixinBlock':
		case 'YieldBlock':
		case 'Include':
		case 'RawInclude':
		case 'Extends':
		case 'Filter':
			return -1;
	}
}

/** Emits an element, closed by `/>` without content, so that a void element needs no end tag. */
function emitTag(emitter: Emitter, tag: Tag) {
	const { pieces, lines } = emitter;
	const start = offsetAt(lines, tag.line, tag.column);
	const headEnd = endAt(emitter, start);
	pieces.push({ start, end: start, text: '<' });
	const at = emitAttributes(emitter, tag.attrs, emitTagName(emitter, tag.name, start));
	gap(emitter, at, headEnd);
	if (!tag.block.nodes.length) {
		pieces.push({ start: headEnd, end: headEnd, text: '/>' });
		return headEnd;
	}
	pieces.push({ start: headEnd, end: headEnd, text: '>' });
	const end = Math.max(headEnd, emitNodes(emitter, tag.block.nodes));
	pieces.push({ start: end, end, text: '</' });
	emitTagName(emitter, tag.name, start);
	pieces.push({ start: end, end, text: '>' });
	return end;
}

/** Emits the name of a tag that starts at `start`, and returns where the name ends: `start` for an implicit `div`. */
function emitTagName(emitter: Emitter, name: string, start: number) {
	if (emitter.source.startsWith(name, start)) {
		keep(emitter, start, start + name.length);
		return start + name.length;
	}
	emitter.pieces.push({ start, end: start, text: name });
	return start;
}

/**
 * Emits the attributes of a tag, from `at`, the end of what is emitted before them, and returns the end of the last.
 * A class or id literal, such as `.a` or `#b`, is an attribute whose quoted value is the name after its `.` or `#`.
 */
function emitAttributes(emitter: Emitter, attrs: Attribute[], at: number) {
	const { source, pieces, lines } = emitter;
	for (const attr of attrs) {
		const start = offsetAt(lines, attr.line, attr.column);
		gap(emitter, at, start);
		const first = source[start];
		if (attr.name === 'class' && first === '.' || attr.name === 'id' && first === '#') {
			at = start + (attr.val as string).length - 1;
			pieces.push({ start, end: start, text: ` ${attr.name}=` });
			pieces.push({ start, end: start + 1, text: '"' });
			keep(emitter, start + 1, at);
			pieces.push({ start: at, end: at, text: '"' });
		}
		else {
			at = emitAttribute(emitter, attr, start);
		}
	}
	return at;
}

/** Emits an attribute of an attribute list, with its name unquoted and the `!` of `!=` left out. */
function emitAttribute(emitter: Emitter, attr: Attribute, start: number) {
	const { source } = emitter;
	let nameEnd = start + attr.name.length;
	if (source.startsWith(attr.name, start)) {
		keep(emitter, start, nameEnd);
	}
	else {
		nameEnd += 2;
		gap(emitter, start, start + 1);
		keep(emitter, start + 1, nameEnd - 1);
		gap(emitter, nameEnd - 1, nameEnd);
	}
	if (attr.val === true) {
		return nameEnd;
	}
	const end = endAt(emitter, start);
	const equals = source.indexOf('=', nameEnd);
	let valueStart = equals + 1;
	while (isSpace(source.charCodeAt(valueStart))) {
		valueStart++;
	}
	gap(emitter, nameEnd, equals);
	keep(emitter, equals, valueStart);
	emitValue(emitter, valueStart, end);
	return end;
}

/**
 * Emits the JavaScript code of an attribute value as it is. A single string or template literal is an HTML value in
 * quotes that it has not in it: its own, or else `"`, or else `'`; with both in it, its `"` are `'`. So an HTML
 * parser reads the value to its end, as one value.
 */
function emitValue(emitter: Emitter, start: number, end: number) {
	const { source, pieces } = emitter;
	const quote = source[start]!;
	if ((quote !== '"' && quote !== "'" && quote !== '`') || end - start < 2 || source[end - 1] !== quote) {
		keep(emitter, start, end);
		return;
	}
	let hasDouble = false;
	let hasSingle = false;
	for (let i = start + 1; i < end - 1; i++) {
		const char = source[i];
		if (char === '\\') {
			hasDouble ||= source[i + 1] === '"';
			hasSingle ||= source[i + 1] === "'";
			i++;
		}
		else if (char === quote) {
			keep(emitter, start, end);
			return;
		}
		else {
			hasDouble ||= char === '"';
			hasSingle ||= char === "'";
		}
	}
	const htmlQuote = quote === '"' && !hasDouble || quote === "'" && !hasSingle
		? quote
		: hasDouble && !hasSingle
		? "'"
		: '"';
	put(emitter, start, start + 1, htmlQuote);
	let kept = start + 1;
	for (let i = start + 1; i < end - 1; i++) {
		if (source[i] === htmlQuote) {
			keep(emitter, kept, i);
			pieces.push({ start: i, end: i + 1, text: "'" });
			kept = i + 1;
		}
	}
	keep(emitter, kept, end - 1);
	put(emitter, end - 1, end, htmlQuote);
}

function emitText(emitter: Emitter, text: Text) {
	const { lines } = emitter;
	if (text.val === '') {
		return -1;
	}
	if (text.val === '\n') {
		// pug's line break between two lines of text, at the start of the second
		keep(emitter, lines.ends[text.line - 2]!, lines.starts[text.line - 1]!);
		return -1;
	}
	const start = offsetAt(lines, text.line, text.column);
	const end = endAt(emitter, start);
	keep(emitter, start, end);
	return end;
}

/** Emits a comment, `//-` too, for the directive comments of Vue, such as `@vue-ignore`. */
function emitComment(emitter: Emitter, comment: Comment | BlockComment) {
	const { pieces } = emitter;
	const start = offsetAt(emitter.lines, comment.line, comment.column);
	const valStart = start + (comment.buffer ? 2 : 3);
	pieces.push({ start, end: valStart, text: '<!--' });
	let end = valStart + comment.val.length;
	keep(emitter, valStart, end);
	if (comment.type === 'BlockComment') {
		end = Math.max(end, emitNodes(emitter, comment.block.nodes));
	}
	pieces.push({ start: end, end, text: '-->' });
	return end;
}

function endAt(emitter: Emitter, start: number) {
	const end = emitter.ends.get(start);
	if (end === undefined) {
		throw new Error(`No token of pug starts at ${start}.`);
	}
	return end;
}

/** Emits `text` for `start`..`end`, as kept text if it is the template text there. */
function put(emitter: Emitter, start: number, end: number, text: string) {
	if (end - start === text.length && emitter.source.startsWith(text, start)) {
		keep(emitter, start, end);
	}
	else {
		emitter.pieces.push({ start, end, text });
	}
}

/** Emits the template text of `start`..`end`, as part of the previous piece if that keeps the text before it. */
function keep({ pieces }: Emitter, start: number, end: number) {
	if (start === end) {
		return;
	}
	const last = pieces[pieces.length - 1];
	if (typeof last === 'object' && last.text === undefined && last.end === start) {
		last.end = end;
	}
	else {
		pieces.push({ start, end });
	}
}

/** Emits the template text of `start`..`end` between parts of a tag, with its chars that are not whitespace as spaces. */
function gap(emitter: Emitter, start: number, end: number) {
	const { source } = emitter;
	while (start < end) {
		const space = isSpace(source.charCodeAt(start));
		let to = start + 1;
		while (to < end && isSpace(source.charCodeAt(to)) === space) {
			to++;
		}
		if (space) {
			keep(emitter, start, to);
		}
		else {
			emitter.pieces.push({ start, end: to, text: ' '.repeat(to - start) });
		}
		start = to;
	}
}

function isSpace(char: number) {
	return char === 32 || char === 9 || char === 10 || char === 13 || char === 12;
}
