Pug compiled to HTML as [muggle-string](https://github.com/johnsoncodehk/muggle-string) segments that map to the pug code.

muggle-pug depends only on muggle-string, `pug-lexer` and `pug-parser`, and builds no mappings: every consumer turns the segments into the mappings of its own tooling.

## Usage

```ts
import { parse } from 'muggle-pug';

const { htmlCode, segments, ast, error, emptyLineEnds } = parse('div.foo hello');
// htmlCode: "<div class='foo'>hello</div>"
// segments: [..., ['hello', undefined, 8, 5], ...]
```

- `segments`: the HTML, as text and `[text, undefined, sourceOffset, sourceLength]` that copy the pug code at `sourceOffset`. A source length that differs from the text is of a char that pug adds, such as the closing quote of the value of `.foo`.
- `htmlCode`: the text of the segments.
- `ast`: the pug AST, with 1-based lines and columns.
- `error`: the lexer or parser error, with 0-based `line` and `column`.
- `emptyLineEnds`: the offsets of the line ends of the empty lines before a line.

Vue dedents a pug template, but pug rejects an indented first line, so an indented template is parsed as the children of a `template` tag that is blanked out of the HTML and left out of the mapped segments, the AST and the offsets.
