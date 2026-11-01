# muggle-pug

I wrote muggle-pug for [vuejs/language-tools](https://github.com/vuejs/language-tools), so that a Vue template written in pug reads as HTML to the language server, and every result maps back to the pug code. It compiles pug to HTML as the pieces of [muggle-string](https://github.com/johnsoncodehk/muggle-string): ranges of the pug code, kept wherever the HTML is the pug code.

It depends only on `pug-lexer`, `pug-parser` and the `Piece` type of muggle-string, and builds no mappings: every consumer turns the pieces into the mappings of its own tooling.

## Adoption

- [vuejs/language-tools](https://github.com/vuejs/language-tools): compiles the pug templates of Vue single-file components for the language server. Its releases compile pug with muggle-string 0.4; the move to muggle-pug is in progress and not released.

## Install

`npm install muggle-pug`. It ships as ES modules only. CommonJS code can `require` it on Node 20.19 and later, or 22.12 and later.

## Usage

```ts
import { compile } from 'muggle-pug';

const pugCode = 'div.foo hello';
const { pieces, ast, error } = compile(pugCode);
// pieces: [..., { start: 8, end: 13 }, ...]
const html = pieces.map(piece => typeof piece === 'string' ? piece : piece.text ?? pugCode.slice(piece.start, piece.end)).join('');
// html: '<div class="foo">hello</div>'
```

- `pieces`: the HTML, as muggle-string ranges of the pug code, with no `source` and no data. A range without `text` keeps the pug code at `start`..`end`. A range with `text` is HTML that stands for its range: `"` for the `.` of `.foo`, or, as an empty range, a position, such as `<` at the start of a tag.
- `ast`: the AST of pug-parser, with 1-based lines and columns of the pug code.
- `error`: the first error of pug, with its `code`, `message`, `offset`, and 0-based `line` and `column`; `undefined` if there is none.

## The HTML

The HTML is for tools, not what pug renders: an HTML parser reads it as the elements, attributes, text and comments written in the pug code, and each of them is the pug code where it can be. Nothing is evaluated, as a value that is not its code maps to nothing in it.

- Attribute values, text and code are the pug code, byte for byte. pug's `class="a" + b`, `` `${a}` `` or `'a\'b'` is code that only pug's runtime gives a value; here it stays code.
- What is not the pug code is the least that makes the HTML read right, one char for one where it can be:
  - `<`, `>`, `/>` and `</` at positions, and the name of an end tag as the range of the name of the tag. An element without content closes with `/>`, so that no void element has an end tag. An implicit `div` is at the position of the tag.
  - A class or id literal, `.foo` or `#foo`, is ` class=` at its position, `"` for its `.` or `#`, and `"` at its end. Each is its own attribute, as `.foo(class="bar")` makes two class attributes anyway (the Vue plugin of vuejs/language-tools ignores the duplicate).
  - The parentheses, the commas and the quotes of a name of an attribute list are spaces, and so is the `!` of `!=`, so that the name is the name.
  - A value that is one string or template literal is in quotes that are not in it: its own, or else `"`, or else `'`. With both in it, its `"` are `'`, so that the value ends where the literal does.
  - A comment, `//-` too, is `<!--` for its `//` and `-->` at its end, for the directive comments of Vue, such as `@vue-ignore`.
- Conditionals, loops, mixins and code add the markup inside them: every branch, once. Doctypes, includes, extends and filters add none.

## Errors

pug stops at its first error, but a template that is being written still needs HTML. So muggle-pug leaves out the line that pug fails on, one at a time, until pug reads the rest: `pieces` and `ast` cover the other lines, and `error` is the first error.

```ts
const { pieces, error } = compile('div\n  p(cl\n  span hi');
// html: '<div><span>hi</span></div>'
// error: { code: 'PUG:NO_END_BRACKET', line: 2, column: 9, ... }
```

`compile` does not throw: an error that pug throws without a position, such as the `TypeError` of `div#` at the end of the code, is at where pug stops, with the name or code of the error.

## Indentation

Vue dedents a pug template, but pug reads an indented first line as text, so pug is given the template without the indentation that all its lines share; the pieces, the AST and the error are all of the written template.

## Source map

The pieces carry no `source`, as all of them are of the one pug code. To render them with `renderWithSourceMap` of muggle-string, give each range its source:

```ts
import { compile } from 'muggle-pug';
import { renderWithSourceMap } from 'muggle-string';

const source = { name: 'App.pug', content: 'div.foo hello' };
const { pieces } = compile(source.content);
const { text, map } = renderWithSourceMap(
	sink => pieces.forEach(piece => sink(typeof piece === 'string' ? piece : { ...piece, source })),
	(from: typeof source) => from.name,
);
console.log(text);
// <div class="foo">hello</div>
console.log(map.mappings);
// AAAA,CAAA,GAAG,OAAA,CAAC,GAAG,CAAA,CAAC,KAAK,EAAb,GAAa
console.log(map.names);
// [], as no HTML renames a name of the pug code
```
