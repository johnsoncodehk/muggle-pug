/**
 * The AST of pug-parser 6, which has no types of its own. Lines and columns are 1-based, in the template as given to
 * `compile`.
 */

export type Node =
	| Block
	| NamedBlock
	| Tag
	| InterpolatedTag
	| Text
	| Code
	| Comment
	| BlockComment
	| Doctype
	| Conditional
	| Case
	| When
	| Each
	| EachOf
	| While
	| Mixin
	| MixinBlock
	| YieldBlock
	| Include
	| RawInclude
	| Extends
	| Filter;

interface Located {
	line: number;
	column: number;
	filename?: string;
}

export interface Block {
	type: 'Block';
	nodes: Node[];
	line: number;
}

export interface NamedBlock extends Located {
	type: 'NamedBlock';
	name: string;
	mode: 'replace' | 'append' | 'prepend';
	nodes: Node[];
}

export interface Attribute extends Located {
	name: string;
	/** The JavaScript code of the value, or `true` for an attribute without one. */
	val: string | true;
	mustEscape: boolean;
}

export interface AttributeBlock extends Located {
	type: 'AttributeBlock';
	val: string;
}

interface Element extends Located {
	selfClosing: boolean;
	block: Block;
	attrs: Attribute[];
	attributeBlocks: AttributeBlock[];
	isInline: boolean;
	textOnly?: boolean;
}

export interface Tag extends Element {
	type: 'Tag';
	name: string;
}

export interface InterpolatedTag extends Element {
	type: 'InterpolatedTag';
	expr: string;
}

export interface Text extends Located {
	type: 'Text';
	val: string;
	isHtml?: boolean;
}

export interface Code extends Located {
	type: 'Code';
	val: string;
	buffer: boolean;
	mustEscape: boolean;
	isInline: boolean;
	block?: Block;
}

export interface Comment extends Located {
	type: 'Comment';
	val: string;
	buffer: boolean;
}

export interface BlockComment extends Located {
	type: 'BlockComment';
	val: string;
	buffer: boolean;
	block: Block;
}

export interface Doctype extends Located {
	type: 'Doctype';
	val: string;
}

export interface Conditional extends Located {
	type: 'Conditional';
	test: string;
	consequent: Block;
	alternate: Conditional | Block | null;
}

export interface Case extends Located {
	type: 'Case';
	expr: string;
	block: Block;
}

export interface When extends Located {
	type: 'When';
	expr: string;
	block?: Block;
	debug: boolean;
}

export interface Each extends Located {
	type: 'Each';
	obj: string;
	val: string;
	key: string | null;
	block: Block;
	alternate?: Block;
}

export interface EachOf extends Located {
	type: 'EachOf';
	obj: string;
	val: string;
	block: Block;
}

export interface While extends Located {
	type: 'While';
	test: string;
	block: Block;
}

export interface Mixin extends Located {
	type: 'Mixin';
	name: string;
	args: string | null;
	block: Block | null;
	call: boolean;
	attrs: Attribute[];
	attributeBlocks: AttributeBlock[];
}

export interface MixinBlock extends Located {
	type: 'MixinBlock';
}

export interface YieldBlock extends Located {
	type: 'YieldBlock';
}

export interface FileReference extends Located {
	type: 'FileReference';
	path: string;
}

export interface IncludeFilter extends Located {
	type: 'IncludeFilter';
	name: string;
	attrs: Attribute[];
}

export interface Include extends Located {
	type: 'Include';
	file: FileReference;
	filters: IncludeFilter[];
	block: Block;
}

export interface RawInclude extends Located {
	type: 'RawInclude';
	file: FileReference;
	filters: IncludeFilter[];
}

export interface Extends extends Located {
	type: 'Extends';
	file: FileReference;
}

export interface Filter extends Located {
	type: 'Filter';
	name: string;
	block: Block;
	attrs: Attribute[];
}
