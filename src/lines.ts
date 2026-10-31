/** Line and column offsets of a text, as `TextDocument` of `vscode-languageserver-textdocument` reads them. */
export class Lines {
	private readonly offsets: number[] = [0];

	constructor(readonly text: string) {
		for (let i = 0; i < text.length; i++) {
			const ch = text.charCodeAt(i);
			if (isEOL(ch)) {
				if (ch === 13 && text.charCodeAt(i + 1) === 10) {
					i++;
				}
				this.offsets.push(i + 1);
			}
		}
	}

	/** The offset of the 0-based `line` and `character`, clamped to the text and before the end of the line. */
	offsetAt(line: number, character: number) {
		const { offsets } = this;
		if (line >= offsets.length) {
			return this.text.length;
		}
		if (line < 0) {
			return 0;
		}
		const lineOffset = offsets[line]!;
		if (character <= 0) {
			return lineOffset;
		}
		const nextLineOffset = line + 1 < offsets.length ? offsets[line + 1]! : this.text.length;
		return this.beforeEOL(Math.min(lineOffset + character, nextLineOffset), lineOffset);
	}

	private beforeEOL(offset: number, lineOffset: number) {
		while (offset > lineOffset && isEOL(this.text.charCodeAt(offset - 1))) {
			offset--;
		}
		return offset;
	}
}

function isEOL(ch: number) {
	return ch === 13 || ch === 10;
}
