import { describe, expect, it } from 'vitest';
import type { Piece } from 'muggle-string';
import { parse } from '../src';

describe('parse', () => {
	it('the example of the readme', () => {
		const pugCode = 'div.foo hello';
		const { pieces } = parse(pugCode);
		expect(toString(pieces, pugCode)).toBe(`<div class='foo'>hello</div>`);
		expect(pieces).toContainEqual({ start: 8, end: 13 });
	});

	describe('multiline class binding with backticks', () => {
		it('should parse multiline :class attribute with backtick template string', () => {
			const pugCode = `span(
  v-tooltip="{ text: 'Hello' }"
  @click="onClick('item')"
  :class=\`[
    "my-component__element",
    "my-component__modifier",
    {
      "my-component__element--active my-component__element--highlighted": (isActive === 'yes')
    }
  ]\`
  data-testid="my-element"
)`;

			const result = parse(pugCode);

			expect(result.error).toBeUndefined();
			expect(toString(result.pieces, pugCode)).toContain('<span');
			expect(toString(result.pieces, pugCode)).toContain(':class=');
		});

		it('should correctly convert backtick to double quotes when no double quotes inside', () => {
			const pugCode = `div(:class=\`['foo', 'bar']\`)`;

			const result = parse(pugCode);

			expect(result.error).toBeUndefined();
			expect(toString(result.pieces, pugCode)).toContain(":class=\"['foo', 'bar']\"");
		});

		it('should correctly convert backtick to single quotes when double quotes inside', () => {
			const pugCode = `div(:class=\`["foo", "bar"]\`)`;

			const result = parse(pugCode);

			expect(result.error).toBeUndefined();
			expect(toString(result.pieces, pugCode)).toContain(':class=\'["foo", "bar"]\'');
		});

		it('should handle multiline backtick values with newlines', () => {
			const pugCode = `div(
  :class=\`[
    "foo",
    "bar"
  ]\`
)`;

			const result = parse(pugCode);

			expect(result.error).toBeUndefined();
		});

		it('should write attribute values with both quote types as single-quoted HTML attributes', () => {
			const pugCode = `span(
  v-tooltip="{ text: 'Hello' }"
  @click="onClick('item')"
  :class=\`[
    "my-component__element",
    "my-component__modifier",
    {
      "my-component__element--active my-component__element--highlighted": (state.type === 'active')
    }
  ]\`
  data-testid="my-element"
)`;

			const result = parse(pugCode);
			expect(result.error).toBeUndefined();

			expect(toString(result.pieces, pugCode)).toBe(`<span 
  v-tooltip="{ text: 'Hello' }"
  @click="onClick('item')"
  :class='[
    "my-component__element",
    "my-component__modifier",
    {
      "my-component__element--active my-component__element--highlighted": (state.type === "active")
    }
  ]'
  data-testid="my-element"
 />`);
		});

		it('should convert inner single quotes to double quotes when both quote types present', () => {
			const pugCode = `div(:class=\`["foo", 'bar']\`)`;
			const result = parse(pugCode);

			expect(result.error).toBeUndefined();
			// Inner single quotes are converted to double quotes, outer delimiter becomes single quote
			expect(toString(result.pieces, pugCode)).toContain(':class=\'["foo", "bar"]\'');
		});

		it('should write the whole HTML when both quote types present', () => {
			const pugCode = `div(:class=\`["foo", 'bar']\`)`;
			const result = parse(pugCode);

			expect(toString(result.pieces, pugCode)).toBe(`<div :class='["foo", "bar"]' />`);
		});
	});

	describe('pieces', () => {
		it('are the HTML, and map tag names, attributes and text to the pug code', () => {
			const pugCode = 'div#app(title="x")\n  p.text hello\n  a(href="/") link\n';
			const result = parse(pugCode);

			for (const text of ['div', 'title="x"', 'hello', 'href="/"', 'link']) {
				expect(result.pieces).toContainEqual({ start: pugCode.indexOf(text), end: pugCode.indexOf(text) + text.length });
			}
		});

		it('map a class or id attribute name to the dot or hash', () => {
			const result = parse('div.foo#bar');

			expect(result.pieces.filter(piece => typeof piece !== 'string' && piece.start === 3)).toEqual([
				{ start: 3, end: 4, text: 'class' },
				{ start: 3, end: 7, text: "'foo" },
			]);
			expect(result.pieces).toContainEqual({ start: 7, end: 8, text: 'id' });
		});

		it('write the attributes in the order of the code, each once', () => {
			const pugCode = 'div(a)(b).foo(c!="x") t';
			expect(toString(parse(pugCode).pieces, pugCode)).toBe(`<div a b class='foo' c!="x">t</div>`);
		});

		it('give the closing quote of a class literal no source', () => {
			const pugCode = 'div.foo';
			const result = parse(pugCode);

			expect(toString(result.pieces, pugCode)).toBe("<div class='foo' />");
			expect(result.pieces).toContainEqual({ start: pugCode.length, end: pugCode.length, text: "'" });
		});

		it('map the lines of CRLF code', () => {
			const pugCode = 'div\r\n  p hello\r\n';
			const result = parse(pugCode);

			expect(result.error).toBeUndefined();
			expect(result.pieces).toContainEqual({ start: pugCode.indexOf('hello'), end: pugCode.indexOf('hello') + 'hello'.length });
		});

		it('are the HTML up to the error', () => {
			const result = parse('div(');

			expect(result.error?.code).toBe('PUG:NO_END_BRACKET');
			expect(result.pieces).toEqual([]);
		});
	});

	describe('indented template', () => {
		const indented = '\n  div(:class="x")\n\n    span {{ a }}\n  p\n';
		const dedented = indented.replace(/^ {2}/gm, '');

		it('parses as the template written without the indent', () => {
			const result = parse(indented);

			expect(result.error).toBeUndefined();
			expect(toString(result.pieces, indented)).toBe(toString(parse(dedented).pieces, dedented));
		});

		it('maps the HTML to the written template', () => {
			const result = parse(indented);

			expect(result.pieces.some(piece => typeof piece !== 'string')).toBe(true);
			for (const piece of result.pieces) {
				if (typeof piece !== 'string') {
					expect(piece.text).toBeUndefined();
				}
			}
		});

		it('reports the lines and columns of the written template', () => {
			expect(collect(parse(indented).ast, 'line')).toEqual(collect(parse(dedented).ast, 'line'));
			expect(collect(parse(indented).ast, 'column')).toEqual(collect(parse(dedented).ast, 'column').map(c => c + 2));
		});

		it('reports an error at the line of the written template', () => {
			const broken = '\n  div\n    span(title="x"\n  p\n';
			const result = parse(broken);

			expect(result.error?.code).toBe('PUG:NO_END_BRACKET');
			expect(result.error?.line).toBe(parse(broken.replace(/^ {2}/gm, '')).error?.line);
		});
	});
});

function collect(node: unknown, key: 'line' | 'column', values: number[] = []) {
	if (node && typeof node === 'object') {
		if (key in node && typeof (node as Record<string, unknown>)[key] === 'number') {
			values.push((node as Record<string, number>)[key]!);
		}
		for (const value of Object.values(node)) {
			collect(value, key, values);
		}
	}
	return values;
}

function toString(pieces: Piece[], pugCode: string) {
	return pieces.map(piece => typeof piece === 'string' ? piece : piece.text ?? pugCode.slice(piece.start, piece.end))
		.join('');
}
