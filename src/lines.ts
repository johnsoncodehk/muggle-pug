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

	/** The 0-based line of `offset`. */
	lineAt(offset: number) {
		const { offsets } = this;
		offset = Math.max(Math.min(offset, this.text.length), 0);
		let low = 0;
		let high = offsets.length;
		while (low < high) {
			const mid = (low + high) >>> 1;
			if (offsets[mid]! > offset) {
				high = mid;
			}
			else {
				low = mid + 1;
			}
		}
		return low - 1;
	}

	/** The text of the 0-based `line`, without its line break, except a `\r` of a `\r\n`. */
	lineText(line: number) {
		const endOffset = this.offsetAt(line + 1, 0);
		const end = this.lineAt(endOffset) === line ? endOffset : endOffset - 1;
		return this.text.substring(this.offsetAt(line, 0), this.normalize(end));
	}

	/** `offset` clamped to the text and moved before the end of its line. */
	private normalize(offset: number) {
		offset = Math.max(Math.min(offset, this.text.length), 0);
		return this.beforeEOL(offset, this.offsets[this.lineAt(offset)]!);
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
