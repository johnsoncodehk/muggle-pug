import * as CompilerDOM from '@vue/compiler-dom';
import { describe, expect, it } from 'vitest';
import { parse, type PugPiece } from '../src';

describe('parse', () => {
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
			expect(result.htmlCode).toContain('<span');
			expect(result.htmlCode).toContain(':class=');
		});

		it('should correctly convert backtick to double quotes when no double quotes inside', () => {
			const pugCode = `div(:class=\`['foo', 'bar']\`)`;

			const result = parse(pugCode);

			expect(result.error).toBeUndefined();
			expect(result.htmlCode).toContain(":class=\"['foo', 'bar']\"");
		});

		it('should correctly convert backtick to single quotes when double quotes inside', () => {
			const pugCode = `div(:class=\`["foo", "bar"]\`)`;

			const result = parse(pugCode);

			expect(result.error).toBeUndefined();
			expect(result.htmlCode).toContain(':class=\'["foo", "bar"]\'');
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

		it('should produce valid HTML that Vue compiler can parse when both quote types present', () => {
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

			const errors: any[] = [];
			CompilerDOM.parse(result.htmlCode, {
				onError(error) {
					errors.push(error);
				},
			});

			expect(errors).toHaveLength(0);
		});

		it('should convert inner single quotes to double quotes when both quote types present', () => {
			const pugCode = `div(:class=\`["foo", 'bar']\`)`;
			const result = parse(pugCode);

			expect(result.error).toBeUndefined();
			// Inner single quotes are converted to double quotes, outer delimiter becomes single quote
			expect(result.htmlCode).toContain(':class=\'["foo", "bar"]\'');
		});

		it('should produce valid JavaScript expression when both quote types present', () => {
			const pugCode = `div(:class=\`["foo", 'bar']\`)`;
			const result = parse(pugCode);

			const errors: any[] = [];
			const ast = CompilerDOM.parse(result.htmlCode, {
				onError(error) {
					errors.push(error);
				},
			});

			expect(errors).toHaveLength(0);

			const div = ast.children[0] as CompilerDOM.ElementNode;
			const classDir = div.props.find((p): p is CompilerDOM.DirectiveNode =>
				p.type === CompilerDOM.NodeTypes.DIRECTIVE && p.name === 'bind'
			);

			// Single quotes in the original are converted to double quotes
			expect((classDir?.exp as CompilerDOM.SimpleExpressionNode)?.content).toBe('["foo", "bar"]');
		});
	});

	describe('pieces', () => {
		it('are the HTML, and map tag names, attributes and text to the pug code', () => {
			const pugCode = 'div#app(title="x")\n  p.text hello\n  a(href="/") link\n';
			const result = parse(pugCode);

			expect(toString(result.pieces, pugCode)).toBe(result.htmlCode);
			for (const text of ['div', 'title="x"', 'hello', 'href="/"', 'link']) {
				expect(result.pieces).toContainEqual({ start: pugCode.indexOf(text), end: pugCode.indexOf(text) + text.length });
			}
		});

		it('map each char of a class or id attribute name to the dot or hash', () => {
			const result = parse('div.foo');

			expect(result.pieces.filter(piece => typeof piece !== 'string' && piece.start === 3)).toEqual(
				[...'class'].map(text => ({ start: 3, end: 4, text })).concat([{ start: 3, end: 7, text: "'foo" }]),
			);
		});

		it('give the closing quote of a class literal no source', () => {
			const pugCode = 'div.foo';
			const result = parse(pugCode);

			expect(result.htmlCode).toBe("<div class='foo' />");
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
			expect(result.htmlCode).toBe('');
		});
	});

	describe('indented template', () => {
		const indented = '\n  div(:class="x")\n\n    span {{ a }}\n  p\n';
		const dedented = indented.replace(/^ {2}/gm, '');

		it('parses as the template written without the indent', () => {
			const result = parse(indented);

			expect(result.error).toBeUndefined();
			expect(result.htmlCode.trim()).toBe(parse(dedented).htmlCode);
		});

		it('keeps the HTML at the offsets of a template tag around it', () => {
			const result = parse(indented);

			expect(result.htmlCode.startsWith(' '.repeat('<template>'.length) + '<div')).toBe(true);
			expect(result.htmlCode.endsWith('<p />' + ' '.repeat('</template>'.length))).toBe(true);
		});

		it('maps the HTML to the written template', () => {
			const result = parse(indented);

			expect(toString(result.pieces, indented)).toBe(result.htmlCode);
			expect(result.pieces.some(piece => typeof piece !== 'string')).toBe(true);
			for (const piece of result.pieces) {
				if (typeof piece !== 'string') {
					expect(piece.text).toBeUndefined();
				}
			}
		});

		it('reports the lines of the written template', () => {
			expect(collectLines(parse(indented).ast)).toEqual(collectLines(parse(dedented).ast));
		});

		it('reports the empty line ends of the written template', () => {
			const pugCode = '\n  div\n\n  p\n';
			const result = parse(pugCode);

			expect(result.emptyLineEnds).toEqual([pugCode.indexOf('\n\n') + 1]);
		});

		it('reports an error at the line of the written template', () => {
			const broken = '\n  div\n    span(title="x"\n  p\n';
			const result = parse(broken);

			expect(result.error?.code).toBe('PUG:NO_END_BRACKET');
			expect(result.error?.line).toBe(parse(broken.replace(/^ {2}/gm, '')).error?.line);
		});
	});
});

function collectLines(node: unknown, lines: number[] = []) {
	if (node && typeof node === 'object') {
		if ('line' in node && typeof node.line === 'number') {
			lines.push(node.line);
		}
		for (const value of Object.values(node)) {
			collectLines(value, lines);
		}
	}
	return lines;
}

function toString(pieces: PugPiece[], pugCode: string) {
	return pieces.map(piece => typeof piece === 'string' ? piece : piece.text ?? pugCode.slice(piece.start, piece.end))
		.join('');
}
