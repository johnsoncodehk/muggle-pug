Pug compiled to HTML as pieces that map to the pug code.

muggle-pug depends only on `pug-lexer`, `pug-parser` and the `Piece` type of [muggle-string](https://github.com/johnsoncodehk/muggle-string), and builds no mappings: every consumer turns the pieces into the mappings of its own tooling.

## Usage

```ts
import { parse } from 'muggle-pug';

const { htmlCode, pieces, ast, error, emptyLineEnds } = parse('div.foo hello');
// htmlCode: "<div class='foo'>hello</div>"
// pieces: [..., { start: 8, end: 13 }, ...]
```

- `pieces`: the HTML, as muggle-string pieces of one source and no data: new text and `{ start, end, text? }` ranges of the pug code. A range without `text` copies the pug code there; `text` is HTML that maps to the range as a whole, such as `class` for the `.` of `.foo`, or the closing quote that pug adds to its value (an empty range).
- `htmlCode`: the text of the pieces.
- `ast`: the pug AST, with 1-based lines and columns.
- `error`: the lexer or parser error, with 0-based `line` and `column`.
- `emptyLineEnds`: the offsets of the line ends of the empty lines before a line.

Vue dedents a pug template, but pug reads an indented first line as text, so an indented template is parsed dedented; the pieces, the AST, the error and the offsets are all of the written template.
