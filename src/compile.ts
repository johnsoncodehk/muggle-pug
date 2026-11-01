import type { Piece } from 'muggle-string';
import lex from 'pug-lexer';
import parse from 'pug-parser';
import type { Attribute, Block, BlockComment, Comment, Doctype, Node, Tag, Text } from './ast.js';

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
	/** pug's code, such as `PUG:NO_END_BRACKET`. */
	code: string;
	/** pug's message, without its code frame. */
	message: string;
	/** Where pug reports the error, as an offset of the template. */
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
	/** The length of the leading whitespace of each line. */
	indents: number[];
}

interface Emitter {
	source: string;
	lines: Lines;
	/** The end of the source text that starts at an offset: of a text, an attribute, a doctype, or the head of a tag. */
	ends: Map<number, number>;
	pieces: Piece[];
}

/**
 * Compiles a pug template to HTML. Every markup node written in the template is in the HTML once, as written:
 * conditionals, loops, mixins and code add the markup inside them without being evaluated, and includes, extends and
 * filters, whose content is not markup of the template, add none.
 *
 * pug is given the template without the indentation that all its lines share, as Vue gives a pug template to pug.
 */
export function compile(source: string): CompileResult {
	const lines = scanLines(source);
	let shared = Infinity;
	for (let i = 0; i < lines.starts.length; i++) {
		if (lines.indents[i]! < lines.ends[i]! - lines.starts[i]!) {
			shared = Math.min(shared, lines.indents[i]!);
		}
	}
	const shifts = lines.indents.map(indent => Math.min(indent, shared));
	const emptied = new Uint8Array(lines.starts.length);
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
			const pugError = asPugError(thrown);
			pugError.column += shifts[pugError.line - 1] ?? 0;
			error ??= toCompileError(source, lines, pugError);
			// the token that failed starts after the last one lexed
			const last = lexer.tokens[lexer.tokens.length - 1];
			const after = last
				? offsetAt(lines, last.loc.end.line, last.loc.end.column + shifts[last.loc.end.line - 1]!)
				: 0;
			emptyLineAt(source, lines, emptied, after, thrown);
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
				case 'doctype':
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
			const pugError = asPugError(thrown);
			error ??= toCompileError(source, lines, pugError);
			emptyLineAt(source, lines, emptied, offsetAt(lines, pugError.line, pugError.column), thrown);
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

interface PugError {
	code: string;
	msg: string;
	line: number;
	column: number;
}

function asPugError(thrown: unknown): PugError {
	const error = thrown as Partial<PugError> | null;
	if (typeof error?.code !== 'string' || !error.code.startsWith('PUG:')) {
		throw thrown;
	}
	return error as PugError;
}

function toCompileError(source: string, lines: Lines, error: PugError): CompileError {
	const offset = Math.min(offsetAt(lines, error.line, error.column), source.length);
	const line = Math.min(error.line, lines.starts.length) - 1;
	return { code: error.code, message: error.msg, offset, line, column: offset - lines.starts[line]! };
}

/** The offset of a 1-based line and column of pug. */
function offsetAt(lines: Lines, line: number, column: number) {
	return lines.starts[Math.min(line, lines.starts.length) - 1]! + column - 1;
}

/**
 * Empties the line where pug failed at `offset`: the line of the first char after it that is not whitespace, or,
 * when only whitespace follows, of the last such char before it.
 */
function emptyLineAt(source: string, lines: Lines, emptied: Uint8Array, offset: number, thrown: unknown) {
	let line = 0;
	while (line + 1 < lines.starts.length && lines.starts[line + 1]! <= offset) {
		line++;
	}
	for (let i = line; i < lines.starts.length; i++) {
		if (!emptied[i] && hasCode(source, i === line ? Math.max(offset, lines.starts[i]!) : lines.starts[i]!, lines.ends[i]!)) {
			emptied[i] = 1;
			return;
		}
	}
	for (let i = line; i >= 0; i--) {
		if (!emptied[i] && lines.indents[i]! < lines.ends[i]! - lines.starts[i]!) {
			emptied[i] = 1;
			return;
		}
	}
	throw thrown;
}

function hasCode(source: string, from: number, to: number) {
	for (let i = from; i < to; i++) {
		if (!isSpace(source.charCodeAt(i))) {
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
		case 'Doctype':
			return emitDoctype(emitter, node);
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
			return emitNodes(emitter, node.block.nodes);
		case 'When':
		case 'Code':
			return node.block ? emitNodes(emitter, node.block.nodes) : -1;
		case 'Mixin':
			return node.block ? emitNodes(emitter, node.block.nodes) : -1;
		case 'MixinBlock':
		case 'YieldBlock':
		case 'Include':
		case 'RawInclude':
		case 'Extends':
		case 'Filter':
			return -1;
	}
}

function emitTag(emitter: Emitter, tag: Tag) {
	const { pieces, lines } = emitter;
	const start = offsetAt(lines, tag.line, tag.column);
	const headEnd = endAt(emitter, start);
	pieces.push({ start, end: start, text: '<' });
	let at = emitTagName(emitter, tag.name, start);
	at = emitAttributes(emitter, tag.attrs, at);
	if (tag.selfClosing) {
		gap(emitter, at, headEnd - 1);
		keep(emitter, headEnd - 1, headEnd);
	}
	else {
		gap(emitter, at, headEnd);
	}
	pieces.push({ start: headEnd, end: headEnd, text: '>' });
	const end = Math.max(headEnd, emitNodes(emitter, tag.block.nodes));
	if (!tag.selfClosing && !isVoidElement(tag.name)) {
		pieces.push({ start: end, end, text: '</' });
		emitTagName(emitter, tag.name, start);
		pieces.push({ start: end, end, text: '>' });
	}
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
 * Adjacent class literals, such as `.a.b`, are one class attribute; a class attribute and a class literal are two.
 */
function emitAttributes(emitter: Emitter, attrs: Attribute[], at: number) {
	const { source, pieces, lines } = emitter;
	let classEnd = -1;
	for (const attr of attrs) {
		const start = offsetAt(lines, attr.line, attr.column);
		const first = source.charCodeAt(start);
		const isClass = attr.name === 'class' && first === 46 /* . */;
		if (classEnd !== -1 && !(isClass && start === classEnd)) {
			pieces.push({ start: classEnd, end: classEnd, text: '"' });
			classEnd = -1;
		}
		gap(emitter, at, start);
		if (isClass || attr.name === 'id' && first === 35 /* # */) {
			const end = start + (attr.val as string).length - 1;
			if (classEnd === start) {
				pieces.push({ start, end: start + 1, text: ' ' });
			}
			else {
				pieces.push({ start, end: start, text: isClass ? ' class=' : ' id=' });
				pieces.push({ start, end: start + 1, text: '"' });
			}
			keep(emitter, start + 1, end);
			if (isClass) {
				classEnd = end;
			}
			else {
				pieces.push({ start: end, end, text: '"' });
			}
			at = end;
			continue;
		}
		at = emitAttribute(emitter, attr, start);
	}
	if (classEnd !== -1) {
		pieces.push({ start: classEnd, end: classEnd, text: '"' });
	}
	return at;
}

function emitAttribute(emitter: Emitter, attr: Attribute, start: number) {
	const { source } = emitter;
	let nameEnd = start + attr.name.length;
	if (source.startsWith(attr.name, start)) {
		keep(emitter, start, nameEnd);
	}
	else {
		// a quoted name
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
	// `!` of `!=`
	gap(emitter, nameEnd, equals);
	keep(emitter, equals, valueStart);
	emitValue(emitter, valueStart, end);
	return end;
}

/**
 * Emits the JavaScript code of an attribute value. A string literal, or a template literal without `${`, is the
 * value: in the quote of the literal, `"` for a template literal, with its escapes decoded and that quote in it as a
 * character reference. Other code is kept as it is.
 */
function emitValue(emitter: Emitter, start: number, end: number) {
	const { source, pieces } = emitter;
	const quote = source[start]!;
	if (
		(quote !== '"' && quote !== "'" && quote !== '`')
		|| end - start < 2
		|| source[end - 1] !== quote
		|| !isStringLiteral(source, start, end, quote)
	) {
		keep(emitter, start, end);
		return;
	}
	const htmlQuote = quote === '`' ? '"' : quote;
	const reference = htmlQuote === '"' ? '&quot;' : '&#39;';
	put(emitter, start, start + 1, htmlQuote);
	let kept = start + 1;
	for (let i = start + 1; i < end - 1; i++) {
		let [length, decoded] = [1, source[i]!];
		if (decoded === '\\') {
			[length, decoded] = decodeEscape(source, i);
		}
		else if (decoded !== htmlQuote) {
			continue;
		}
		keep(emitter, kept, i);
		pieces.push({ start: i, end: i + length, text: decoded === htmlQuote ? reference : decoded });
		i += length - 1;
		kept = i + 1;
	}
	keep(emitter, kept, end - 1);
	put(emitter, end - 1, end, htmlQuote);
}

function isStringLiteral(source: string, start: number, end: number, quote: string) {
	for (let i = start + 1; i < end - 1; i++) {
		const char = source[i];
		if (char === '\\') {
			i++;
		}
		else if (char === quote || quote === '`' && char === '$' && source[i + 1] === '{') {
			return false;
		}
	}
	return true;
}

/** The length and the value of the escape sequence of a JavaScript string at `at`. */
function decodeEscape(source: string, at: number): [length: number, decoded: string] {
	const char = source[at + 1]!;
	switch (char) {
		case '\r':
			return [source[at + 2] === '\n' ? 3 : 2, ''];
		case '\n':
		case '\u2028':
		case '\u2029':
			return [2, ''];
		case 'n':
			return [2, '\n'];
		case 't':
			return [2, '\t'];
		case 'r':
			return [2, '\r'];
		case 'b':
			return [2, '\b'];
		case 'f':
			return [2, '\f'];
		case 'v':
			return [2, '\v'];
		case '0':
			return [2, '\0'];
		case 'x':
			return [4, String.fromCharCode(parseInt(source.slice(at + 2, at + 4), 16))];
		case 'u': {
			if (source[at + 2] === '{') {
				const close = source.indexOf('}', at + 3);
				return [close + 1 - at, String.fromCodePoint(parseInt(source.slice(at + 3, close), 16))];
			}
			return [6, String.fromCharCode(parseInt(source.slice(at + 2, at + 6), 16))];
		}
		default:
			return [2, char];
	}
}

function emitText(emitter: Emitter, text: Text) {
	const { lines } = emitter;
	if (text.val === '') {
		return -1;
	}
	if (text.val === '\n') {
		// pug's line break between two lines of text, at the start of the second
		const lineStart = lines.starts[text.line - 1]!;
		put(emitter, lines.ends[text.line - 2]!, lineStart, '\n');
		return -1;
	}
	const start = offsetAt(lines, text.line, text.column);
	const end = endAt(emitter, start);
	put(emitter, start, end, text.val);
	return end;
}

function emitComment(emitter: Emitter, comment: Comment | BlockComment) {
	if (!comment.buffer) {
		return -1;
	}
	const { pieces } = emitter;
	const start = offsetAt(emitter.lines, comment.line, comment.column);
	pieces.push({ start, end: start + 2, text: '<!--' });
	let end = start + 2 + comment.val.length;
	keep(emitter, start + 2, end);
	if (comment.type === 'BlockComment') {
		end = Math.max(end, emitNodes(emitter, comment.block.nodes));
	}
	pieces.push({ start: end, end, text: '-->' });
	return end;
}

function emitDoctype(emitter: Emitter, doctype: Doctype) {
	const { pieces } = emitter;
	const start = offsetAt(emitter.lines, doctype.line, doctype.column);
	const end = endAt(emitter, start);
	pieces.push({ start, end: start + 7, text: '<!DOCTYPE' });
	if (doctype.val) {
		keep(emitter, start + 7, end);
	}
	else {
		pieces.push({ start: end, end, text: ' html' });
	}
	pieces.push({ start: end, end, text: '>' });
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

/** Emits the template text of `start`..`end` between parts of a tag, with a space for each char that is not whitespace. */
function gap(emitter: Emitter, start: number, end: number) {
	const { source } = emitter;
	let i = start;
	while (i < end && isSpace(source.charCodeAt(i))) {
		i++;
	}
	if (i === end) {
		keep(emitter, start, end);
		return;
	}
	let text = source.slice(start, i);
	for (; i < end; i++) {
		text += isSpace(source.charCodeAt(i)) ? source[i] : ' ';
	}
	emitter.pieces.push({ start, end, text });
}

function isSpace(char: number) {
	return char === 32 || char === 9 || char === 10 || char === 13 || char === 12;
}

function isVoidElement(name: string) {
	switch (name) {
		case 'area':
		case 'base':
		case 'br':
		case 'col':
		case 'embed':
		case 'hr':
		case 'img':
		case 'input':
		case 'link':
		case 'meta':
		case 'param':
		case 'source':
		case 'track':
		case 'wbr':
			return true;
	}
	return false;
}
