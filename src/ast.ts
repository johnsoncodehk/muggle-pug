/**
 * The AST of pug-parser 6, which has no types of its own: every node, with the fields that `compile` reads. Lines and
 * columns are 1-based, in the template as given to `compile`.
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

export interface Block {
	type: 'Block';
	nodes: Node[];
	line: number;
}

interface Located {
	line: number;
	column: number;
}

/** A node that adds the markup of `block`, as `When` and `Code` do when they have one. */
interface Parent<Type extends string, B extends Block | undefined | null = Block> extends Located {
	type: Type;
	block: B;
}

/** A node that adds no markup. */
interface Leaf<Type extends string> extends Located {
	type: Type;
}

export interface NamedBlock extends Located {
	type: 'NamedBlock';
	nodes: Node[];
}

export interface Attribute extends Located {
	name: string;
	/** The JavaScript code of the value, or `true` for an attribute without one. */
	val: string | true;
}

export interface Tag extends Parent<'Tag'> {
	name: string;
	attrs: Attribute[];
	selfClosing: boolean;
}

export interface Text extends Located {
	type: 'Text';
	val: string;
}

export interface Comment extends Located {
	type: 'Comment';
	val: string;
	buffer: boolean;
}

export interface BlockComment extends Parent<'BlockComment'> {
	val: string;
	buffer: boolean;
}

export interface Doctype extends Located {
	type: 'Doctype';
	val: string;
}

export interface Conditional extends Located {
	type: 'Conditional';
	consequent: Block;
	alternate: Conditional | Block | null;
}

export interface Each extends Parent<'Each'> {
	alternate?: Block;
}

export type InterpolatedTag = Parent<'InterpolatedTag'>;
export type Case = Parent<'Case'>;
export type EachOf = Parent<'EachOf'>;
export type While = Parent<'While'>;
export type When = Parent<'When', Block | undefined>;
export type Code = Parent<'Code', Block | undefined>;
export type Mixin = Parent<'Mixin', Block | null>;
export type MixinBlock = Leaf<'MixinBlock'>;
export type YieldBlock = Leaf<'YieldBlock'>;
export type Include = Leaf<'Include'>;
export type RawInclude = Leaf<'RawInclude'>;
export type Extends = Leaf<'Extends'>;
export type Filter = Leaf<'Filter'>;
