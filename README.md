Pug compiled to HTML as pieces that map to the pug code.

muggle-pug depends only on `pug-lexer`, `pug-parser` and the `Piece` type of [muggle-string](https://github.com/johnsoncodehk/muggle-string), and builds no mappings: every consumer turns the pieces into the mappings of its own tooling.

## Usage

```ts
import { parse } from 'muggle-pug';

const pugCode = 'div.foo hello';
const { pieces, ast, error } = parse(pugCode);
// pieces: [..., { start: 8, end: 13 }, ...]
const html = pieces.map(piece => typeof piece === 'string' ? piece : piece.text ?? pugCode.slice(piece.start, piece.end)).join('');
// html: "<div class='foo'>hello</div>"
```

- `pieces`: the HTML, as muggle-string pieces of one source and no data: new text and `{ start, end, text? }` ranges of the pug code. A range without `text` copies the pug code there; `text` is HTML that maps to the range as a whole, such as `class` for the `.` of `.foo`, or the closing quote that pug adds to its value (an empty range).
- `ast`: the pug AST, with 1-based lines and columns.
- `error`: the lexer or parser error: `code`, `message`, and 0-based `line` and `column`.

Vue dedents a pug template, but pug reads an indented first line as text, so an indented template is parsed dedented; the pieces, the AST and the error are all of the written template.
