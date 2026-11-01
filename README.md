# muggle-pug

I wrote muggle-pug for [vuejs/language-tools](https://github.com/vuejs/language-tools), so that a Vue template written in pug reads as HTML to the language server, and every result maps back to the pug code. It compiles pug to HTML as the pieces of [muggle-string](https://github.com/johnsoncodehk/muggle-string), which copy the pug code wherever the HTML has it.

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
// html: "<div class='foo'>hello</div>"
```

- `pieces`: the HTML, as muggle-string pieces of one source and no data. A string is new HTML. A range without `text` keeps the pug code at `start`..`end`. A range with `text` is HTML that stands for its range as a whole, such as `class` for the `.` of `.foo`, or the closing quote that pug adds to its value (an empty range).
- `ast`: the pug AST, with 1-based lines and columns.
- `error`: the lexer or parser error: `code`, `message`, and 0-based `line` and `column`. With an error, `pieces` is empty and `ast` is `undefined`.

Vue dedents a pug template, but pug reads an indented first line as text, so an indented template is parsed dedented; the pieces, the AST and the error are all of the written template.

#### Source map

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
// <div class='foo'>hello</div>
console.log(map.mappings);
// A,CAAA,G,CAAG,K,CAAA,IAAI,C,CAAC,K;
```
