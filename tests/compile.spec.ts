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

describe('the examples of the readme', () => {
	it('usage', () => {
		const pugCode = 'div.foo hello';
		const { pieces, ast, error } = compile(pugCode);
		expect(pieces).toContainEqual({ start: 8, end: 13 });
		expect(html(pugCode, pieces)).toBe('<div class="foo">hello</div>');
		expect([ast.nodes.length, error]).toEqual([1, undefined]);
	});

	it('errors', () => {
		const source = 'div\n  p(cl\n  span hi';
		const { pieces, error } = compile(source);
		expect(html(source, pieces)).toBe('<div><span>hi</span></div>');
		expect(error).toMatchObject({ code: 'PUG:NO_END_BRACKET', line: 2, column: 9 });
	});

	it('source map', () => {
		const source = { name: 'App.pug', content: 'div.foo hello' };
		const { pieces } = compile(source.content);
		const { text, map } = renderWithSourceMap(
			sink => pieces.forEach(piece => sink(typeof piece === 'string' ? piece : { ...piece, source })),
			(from: typeof source) => from.name,
		);
		expect(text).toBe('<div class="foo">hello</div>');
		expect(map.mappings).toBe('AAAA,CAAA,GAAG,CAAA,KAAA,CAAA,CAAC,GAAG,CAAA,CAAC,K;');
		expect(map.names).toEqual([]);
	});
});

describe('html', () => {
	it.each([
		['div', '<div/>'],
		['div text', '<div>text</div>'],
		['div\n  p x\n  span {{ a }}', '<div><p>x</p><span>{{ a }}</span></div>'],
		['a(href="/" disabled) link', '<a href="/" disabled >link</a>'],
		['a(href="/", title=\'t\') link', '<a href="/"  title=\'t\' >link</a>'],
		['div(\n  a="1"\n  b\n)', '<div \n  a="1"\n  b\n />'],
		['p(v-if="ok")\np(v-else)', '<p v-if="ok" /><p v-else />'],
		['template(#default="{ a }")\n  | {{ a }}', '<template #default="{ a }" >{{ a }}</template>'],
		['div(.prop="x")', '<div .prop="x" />'],
		['a(href!="/")', '<a href ="/" />'],
		['div(\'(click)\'="go")', '<div  (click) ="go" />'],
		['table: tr: td: input(v-model="name")', '<table><tr><td><input v-model="name" /></td></tr></table>'],
		['input\nimg(src="a")\nbr/\nfoo/', '<input/><img src="a" /><br /><foo />'],
		['div #[span x] y', '<div><span>x</span> y</div>'],
		['p.\n  hello <b>\n  world', '<p >hello <b>\nworld</p>'],
		['p\n  | a\n  | b', '<p>a\nb</p>'],
		['p \\#{a} #{b}', '<p>\\#{a} </p>'],
		['div <span>x</span>\n<hr>', '<div><span>x</span></div><hr>'],
		['// note\n//- @vue-ignore\ndiv', '<!-- note--><!-- @vue-ignore--><div/>'],
		['//\n  a\n  b', '<!--a\nb-->'],
		['doctype html\nhtml', '<html/>'],
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

	it('makes each class literal a class attribute', () => {
		expect(html('.a.b-c(class="d").e#f')).toBe('<div class="a" class="b-c" class="d"  class="e" id="f"/>');
	});

	it('keeps a string or template literal value as it is, in quotes that it does not have in it', () => {
		expect(html(`div(a="b \\"c\\"" d='e\\'s' :f="'\\x41\\\\'")`))
			.toBe(`<div a='b \\"c\\"' d="e\\'s" :f="'\\x41\\\\'" />`);
		expect(html('div(a=`b "c"` d=`${e} f` :g=`{\n  h: 1 }`)')).toBe('<div a=\'b "c"\' d="${e} f" :g="{\n  h: 1 }" />');
		expect(ranges('p(a=`b`)')).toEqual(['""->"<"', 'p', '"("->" "', 'a=', '"`"->"\\""', 'b', '"`"->"\\""', '")"->" "', '""->"/>"']);
	});

	it('swaps the `"` of a value that has both quotes in it for `\'`, one char for one', () => {
		expect(html(`div(a="b \\"c\\" 'd'" e=\`"f" 'g'\`)`)).toBe(`<div a="b \\'c\\' 'd'" e="'f' 'g'" />`);
	});

	it('keeps code that is not a single literal', () => {
		expect(html('div(a=b c="x" + y d=`${`e`}`)')).toBe('<div a=b c="x" + y d=`${`e`}` />');
	});

	it('makes the backslash of a line continuation a space, one char for one, also with CRLF line ends', () => {
		const source = ['div(', `  :class="[ \\`, `    'a', \\`, `  ]"`, ') Foo'].join('\r\n');
		expect(html(source)).toBe(`<div \r\n  :class="[  \r\n    'a',  \r\n  ]"\r\n >Foo</div>`);
		expect(ranges(source)).toContain(`"\\\\"->" "`);
		expect(html('p(a=`b \\\nc` d="e \\\rf" g="h \\i")')).toBe('<p a="b  \nc" d="e  \rf" g="h \\i" />');
	});
});

describe('pieces', () => {
	it('are ranges of the template, kept where the HTML is the template text', () => {
		expect(ranges('div#app.a(:b="c") x')).toEqual([
			'""->"<"',
			'div',
			'""->" "',
			'"#"->"id"',
			'""->"="',
			'"#"->"\\""',
			'app',
			'""->"\\""',
			'""->" "',
			'"."->"class"',
			'""->"="',
			'"."->"\\""',
			'a',
			'""->"\\""',
			'"("->" "',
			':b="c"',
			'")"->" "',
			'""->">"',
			'x',
			'</div>',
			'',
		]);
	});

	it('are ranges within the template, and end tags', () => {
		const sources = [
			'div#app.a.b(class="x" :t="m" href!=\'y\' disabled)\n  span {{ c }} #[b x] #{y}\n  p.\n    hi\n    yo\n  | pipe',
			'\n  div\n    p x\n',
			'\uFEFFdiv\r\n  p x\r  span',
			'div\n  p(cl\n  span hi',
		];
		for (const source of sources) {
			for (const piece of compile(source).pieces) {
				if (typeof piece === 'string') {
					expect(piece).toMatch(/^<\/[\w-]+>$/);
				}
				else {
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
		const name = text.indexOf('class');
		expect([offsets[name], offsets[name + 5]]).toEqual([0, 1]);
	});

	it('end an element at the end of its last content', () => {
		const source = 'div\n  em(v-if="a" v-for="n in b")\n';
		const offsets = templateOffsets(source);
		const text = html(source);
		expect(offsets[text.length]).toBe(source.indexOf(')') + 1);
	});

	it('give an end tag no range, and then the end of the element', () => {
		expect(compile('span x').pieces.slice(-4)).toEqual([{ start: 4, end: 4, text: '>' }, { start: 5, end: 6 }, '</span>', { start: 6, end: 6 }]);
	});
});

describe('templates whose every line is indented', () => {
	it('compile as without the shared indentation, at the offsets of the template', () => {
		const source = '\n  div\n    p(a="b") x\n\n  span\n';
		expect(html(source)).toBe('<div><p a="b" >x</p></div><span/>');
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
		expect(html(source)).toBe('<span/>');
	});

	it('report an error of an indented template at its offset in the template', () => {
		const source = '  div\n    p(a=)\n  span';
		const { error } = compile(source);
		expect(error).toMatchObject({ code: 'PUG:SYNTAX_ERROR', offset: source.indexOf(')'), line: 1, column: 8 });
		expect(html(source)).toBe('<div/><span/>');
	});

	it('leave out each line that pug fails on, one at a time', () => {
		const source = 'div\n  p(a=)\n  i(b=)\n  span';
		const { error } = compile(source);
		expect(error).toMatchObject({ code: 'PUG:SYNTAX_ERROR', line: 1 });
		expect(html(source)).toBe('<div><span/></div>');
	});

	it('keep the lines before an error of indentation', () => {
		const source = 'div\n p\n   a\n  b';
		expect(compile(source).error).toMatchObject({ code: 'PUG:INCONSISTENT_INDENTATION', line: 3 });
		expect(html(source)).toBe('<div><p><a/></p></div>');
	});

	it('report what pug throws for a template that it fails to read, where it stops', () => {
		expect(compile('div\n  p#')).toMatchObject({ error: { code: 'TypeError', offset: 7, line: 1, column: 3 } });
		expect(html('div\n  p#')).toBe('<div/>');
		const source = 'div\n  p&attributes\n  span';
		expect(compile(source)).toMatchObject({ error: { code: 'ERR_ASSERTION', offset: 7, line: 1, column: 3 } });
		expect(html(source)).toBe('<div><span/></div>');
	});

	it('give pug blank lines without their spaces and tabs', () => {
		const source = 'div\n\t\n  p\n  ';
		expect(compile(source).error).toBeUndefined();
		expect(html(source)).toBe('<div><p/></div>');
	});

	it('are none for an empty template', () => {
		expect(compile('')).toEqual({ pieces: [], ast: { type: 'Block', nodes: [], line: 0 }, error: undefined });
	});
});
