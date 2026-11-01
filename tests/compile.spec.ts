import { renderWithSourceMap, type Piece } from 'muggle-string';
import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.js';

function html(source: string, pieces: Piece[] = compile(source).pieces) {
	return pieces.map(piece => typeof piece === 'string' ? piece : piece.text ?? source.slice(piece.start, piece.end))
		.join('');
}

/** The template offset of each HTML offset, as Vue's language core reads pieces: the greatest of the ranges there. */
function templateOffsets(source: string) {
	const offsets: number[] = [];
	let at = 0;
	for (const piece of compile(source).pieces) {
		const text = typeof piece === 'string' ? piece : piece.text ?? source.slice(piece.start, piece.end);
		if (typeof piece !== 'string') {
			for (let i = 0; i <= text.length; i++) {
				offsets[at + i] = Math.max(offsets[at + i] ?? -1, Math.min(piece.start + i, piece.end));
			}
		}
		at += text.length;
	}
	return offsets;
}

function ranges(source: string) {
	return compile(source).pieces.map(piece =>
		typeof piece === 'string'
			? piece
			: piece.text === undefined
			? source.slice(piece.start, piece.end)
			: `${JSON.stringify(source.slice(piece.start, piece.end))}->${JSON.stringify(piece.text)}`
	);
}

describe('html', () => {
	it.each([
		['div', '<div></div>'],
		['div text', '<div>text</div>'],
		['div\n  p x\n  span {{ a }}', '<div><p>x</p><span>{{ a }}</span></div>'],
		['a(href="/" disabled) link', '<a href="/" disabled >link</a>'],
		['a(href="/", title=\'t\') link', '<a href="/"  title=\'t\' >link</a>'],
		['div(\n  a="1"\n  b\n)', '<div \n  a="1"\n  b\n >'.concat('</div>')],
		['p(v-if="ok")\np(v-else)', '<p v-if="ok" ></p><p v-else ></p>'],
		['template(#default="{ a }")\n  | {{ a }}', '<template #default="{ a }" >{{ a }}</template>'],
		['div(.prop="x")', '<div .prop="x" ></div>'],
		['a(href!="/")', '<a href ="/" ></a>'],
		['div(\'(click)\'="go")', '<div  (click) ="go" ></div>'],
		['table: tr: td: input(v-model="name")', '<table><tr><td><input v-model="name" ></td></tr></table>'],
		['input\nimg(src="a")\nbr/\nfoo/', '<input><img src="a" ><br/><foo/>'],
		['div #[span x] y', '<div><span>x</span> y</div>'],
		['p.\n  hello <b>\n  world', '<p >hello <b>\nworld</p>'],
		['p\n  | a\n  | b', '<p>a\nb</p>'],
		['p \\#{a} #{b}', '<p>#{a} </p>'],
		['div <span>x</span>\n<hr>', '<div><span>x</span></div><hr>'],
		['// note\n//- hidden\ndiv', '<!-- note--><div></div>'],
		['//\n  a\n  b', '<!--a\nb-->'],
		['doctype html\nhtml', '<!DOCTYPE html><html></html>'],
		['doctype\nhtml', '<!DOCTYPE html><html></html>'],
	])('%j', (source, expected) => {
		expect(html(source)).toBe(expected);
	});

	it('adds the markup inside build-time constructs, without evaluating them', () => {
		const source = [
			'- const x = 1',
			'if a',
			'  p a',
			'else if b',
			'  p b',
			'else',
			'  p c',
			'each item in items',
			'  li= item',
			'case x',
			'  when 1',
			'    i 1',
			'  default',
			'    i 2',
			'mixin m(a)',
			'  b m',
			'+m(1)',
			'  u in',
			'include other.pug',
			':markdown',
			'  # title',
			'p= x',
		].join('\n');
		expect(html(source)).toBe('<p>a</p><p>b</p><p>c</p><li></li><i>1</i><i>2</i><b>m</b><u>in</u><p></p>');
	});

	it('makes adjacent class literals one attribute, and a class attribute another', () => {
		expect(html('.a.b-c(class="d").e#f')).toBe('<div class="a b-c" class="d"  class="e" id="f"></div>');
	});

	it('decodes the escapes of a string literal', () => {
		expect(html(`div(title="a \\"b\\"" alt='it\\'s' :a="'\\x41\\u0042\\u{43}\\n'")`))
			.toBe(`<div title="a &quot;b&quot;" alt='it&#39;s' :a="'ABC\n'" ></div>`);
	});

	it('quotes a template literal without `${` with `"`, its `"` a character reference', () => {
		expect(html('div(a=`b "c" \'d\' \\`` :e=`{\n  f: 1 }`)'))
			.toBe('<div a="b &quot;c&quot; \'d\' `" :e="{\n  f: 1 }" ></div>');
		expect(ranges('p(a=`b`)')).toEqual(['""->"<"', 'p', '"("->" "', 'a=', '"`"->"\\""', 'b', '"`"->"\\""', '")"->" "', '""->">"', '""->"</"', 'p', '""->">"']);
	});

	it('keeps code that is not a string literal', () => {
		expect(html('div(a=b c="x" + y d=`${e}`)')).toBe('<div a=b c="x" + y d=`${e}` ></div>');
	});

	it('removes the line continuations of a multiline value, also with CRLF line ends', () => {
		const source = ['div(', `  :class="[ \\`, `    'a', \\`, `  ]"`, ') Foo'].join('\r\n');
		expect(html(source)).toBe(`<div \r\n  :class="[     'a',   ]"\r\n >Foo</div>`);
		expect(ranges(source)).toContain(`"\\\\\\r\\n"->""`);
	});
});

describe('pieces', () => {
	it('are ranges of the template, kept where the HTML is the template text', () => {
		expect(ranges('div#app.a(:b="c") x')).toEqual([
			'""->"<"',
			'div',
			'""->" id="',
			'"#"->"\\""',
			'app',
			'""->"\\""',
			'""->" class="',
			'"."->"\\""',
			'a',
			'""->"\\""',
			'"("->" "',
			':b="c"',
			'")"->" "',
			'""->">"',
			'x',
			'""->"</"',
			'div',
			'""->">"',
		]);
	});

	it('cover every char of the HTML, within the template', () => {
		const sources = [
			'div#app.a.b(class="x" :t="m" href!=\'y\' disabled)\n  span {{ c }} #[b x] #{y}\n  p.\n    hi\n    yo\n  | pipe',
			'\n  div\n    p x\n',
			'\uFEFFdiv\r\n  p x\r  span',
			'div\n  p(cl\n  span hi',
		];
		for (const source of sources) {
			for (const piece of compile(source).pieces) {
				expect(typeof piece).toBe('object');
				if (typeof piece === 'object') {
					expect(0 <= piece.start && piece.start <= piece.end && piece.end <= source.length).toBe(true);
				}
			}
		}
	});

	it('map the HTML to the offsets that Vue reads', () => {
		const source = [
			`div(class="a" :title="msg" @click="go")`,
			`  span {{ count }}`,
			`  p(v-if="ok") x`,
		].join('\n');
		const offsets = templateOffsets(source);
		const text = html(source);
		const at = (needle: string, from = 0) => offsets[text.indexOf(needle, from)];
		expect(at('<div')).toBe(0);
		expect(at('class')).toBe(source.indexOf('class'));
		expect(at('"a"')).toBe(source.indexOf('"a"'));
		expect(at('msg')).toBe(source.indexOf('msg'));
		expect(at('<span')).toBe(source.indexOf('span'));
		expect(at('count')).toBe(source.indexOf('count'));
		expect(at('<p')).toBe(source.indexOf('p('));
		expect(offsets[text.length]).toBe(source.length);
	});

	it('give a class literal value the range of the literal', () => {
		const source = '.foo\ndiv.bar';
		const offsets = templateOffsets(source);
		const text = html(source);
		const values = [...text.matchAll(/"[^"]*"/g)].map(match => [
			offsets[match.index],
			offsets[match.index + match[0].length],
		]);
		expect(values).toEqual([[0, 4], [8, 12]]);
	});

	it('end an element at the end of its last content', () => {
		const source = 'div\n  em(v-if="a" v-for="n in b")\n';
		const offsets = templateOffsets(source);
		const text = html(source);
		expect(offsets[text.indexOf('</em>') + 5]).toBe(source.indexOf(')') + 1);
		expect(offsets[text.length]).toBe(source.indexOf(')') + 1);
	});

	it('map a close tag name to the name of the tag', () => {
		expect(compile('span x').pieces.filter(piece => typeof piece === 'object' && piece.text === undefined))
			.toEqual([{ start: 0, end: 4 }, { start: 5, end: 6 }, { start: 0, end: 4 }]);
	});

	it('give a v3 source map without names, as no HTML renames an identifier of the template', () => {
		const source = { name: 'a.pug', content: 'div.a(:b="c")\n  span x' };
		const { text, map } = renderWithSourceMap(
			sink => {
				for (const piece of compile(source.content).pieces) {
					sink(typeof piece === 'string' ? piece : { ...piece, source });
				}
			},
			(from: typeof source) => from.name,
		);
		expect(text).toBe(html(source.content));
		expect(map.names).toEqual([]);
		expect(map.sources).toEqual(['a.pug']);
	});
});

describe('templates whose every line is indented', () => {
	it('compile as without the shared indentation, at the offsets of the template', () => {
		const source = '\n  div\n    p(a="b") x\n\n  span\n';
		expect(html(source)).toBe('<div><p a="b" >x</p></div><span></span>');
		expect(compile(source).error).toBeUndefined();
		expect(ranges(source)).toContain('a="b"');
		const offsets = templateOffsets(source);
		expect(offsets[html(source).indexOf('<p')]).toBe(source.indexOf('p('));
	});

	it('give the AST pug columns of the template', () => {
		const { ast } = compile('    div\n      p');
		const div = ast.nodes[0]!;
		expect(div.type === 'Tag' && [div.line, div.column, div.block.nodes[0]!.line]).toEqual([1, 5, 2]);
		expect(div.type === 'Tag' && div.block.nodes[0]!.type === 'Tag' && div.block.nodes[0]!.column).toBe(7);
	});

	it('take tabs as indentation', () => {
		expect(html('\tdiv\n\t\tp x')).toBe('<div><p>x</p></div>');
	});
});

describe('errors', () => {
	it('report the first error of pug, at a 0-based line and column, and compile the other lines', () => {
		const source = 'div\n  p(cl\n  span hi';
		const { pieces, ast, error } = compile(source);
		expect(error).toEqual({
			code: 'PUG:NO_END_BRACKET',
			message: 'The end of the string reached with no closing bracket ) found.',
			offset: source.length,
			line: 2,
			column: 9,
		});
		expect(html(source, pieces)).toBe('<div><span>hi</span></div>');
		expect(ast.nodes.length).toBe(1);
	});

	it('report an error of the parser', () => {
		const source = 'div(a="1" a="2")\nspan';
		const { error } = compile(source);
		expect(error).toMatchObject({ code: 'PUG:DUPLICATE_ATTRIBUTE', offset: 10, line: 0, column: 10 });
		expect(html(source)).toBe('<span></span>');
	});

	it('report an error of an indented template at its offset in the template', () => {
		const source = '  div\n    p(a=)\n  span';
		const { error } = compile(source);
		expect(error).toMatchObject({ code: 'PUG:SYNTAX_ERROR', offset: source.indexOf(')'), line: 1, column: 8 });
		expect(html(source)).toBe('<div></div><span></span>');
	});

	it('leave out each line that pug fails on, one at a time', () => {
		const source = 'div\n  p(a=)\n  i(b=)\n  span';
		const { error } = compile(source);
		expect(error).toMatchObject({ code: 'PUG:SYNTAX_ERROR', line: 1 });
		expect(html(source)).toBe('<div><span></span></div>');
	});

	it('keep the lines before an error of indentation', () => {
		const source = 'div\n p\n   a\n  b';
		expect(compile(source).error).toMatchObject({ code: 'PUG:INCONSISTENT_INDENTATION', line: 3 });
		expect(html(source)).toBe('<div><p><a></a></p></div>');
	});

	it('are none for an empty template', () => {
		expect(compile('')).toEqual({ pieces: [], ast: { type: 'Block', nodes: [], line: 0 }, error: undefined });
	});
});
