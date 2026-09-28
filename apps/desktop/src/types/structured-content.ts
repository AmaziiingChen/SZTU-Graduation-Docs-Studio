export type StructuredScript = "normal" | "sub" | "super"

export type StructuredRun = {
  text: string
  script?: StructuredScript
  italic?: boolean
  bold?: boolean
}

export type MathExpression =
  | { type: "text"; value: string }
  | { type: "row"; items: MathExpression[] }
  | { type: "fraction"; numerator: MathExpression; denominator: MathExpression }
  | { type: "subscript"; base: MathExpression; sub: MathExpression }
  | { type: "superscript"; base: MathExpression; super: MathExpression }
  | { type: "square_root"; body: MathExpression }

export type InlineEquationRun = { type: "inline_equation"; expression: MathExpression; alt: string }
export type ParagraphRun = StructuredRun | InlineEquationRun

export type RichParagraph = {
  type?: "paragraph"
  runs: ParagraphRun[]
}

export type ParagraphInput = string | RichParagraph

export type OrderedListItem = {
  content: ParagraphInput
  marker?: string
  children?: StructuredListBlock
}

export type UnorderedListItem = {
  content: ParagraphInput
  marker?: never
  children?: StructuredListBlock
}

export type OrderedListBlock = {
  type: "ordered_list"
  items: OrderedListItem[]
}

export type UnorderedListBlock = {
  type: "unordered_list"
  items: UnorderedListItem[]
}

export type StructuredListBlock = OrderedListBlock | UnorderedListBlock

export type StructuredImageBlock = {
  type: "image"
  path: string
  alt: string
  id?: string
  chapter?: number
  width_mm?: number
  caption?: ParagraphInput
  source_citation_key?: string
}

export type StructuredFigureGroupBlock = {
  type: "figure_group"
  id?: string
  chapter?: number
  columns?: number
  items: { path: string; alt: string; caption?: ParagraphInput }[]
  caption: ParagraphInput
  source_citation_key?: string
}

export type StructuredDataTableBlock = {
  type: "data_table"
  style?: "grid" | "three_line"
  columns: { header: ParagraphInput; width_weight?: number; alignment?: "left" | "center" | "right" }[]
  rows: { cells: ParagraphInput[] }[]
  caption?: ParagraphInput
}
export type StructuredEquationBlock = { type: "equation"; id: string; latex: string }
export type ProcessEquationBlock = { type: "equation"; expression: MathExpression; alt: string; id?: string; chapter?: number }

export type StructuredToolBlock = StructuredFigureGroupBlock | StructuredDataTableBlock

/**
 * Contract blocks supported by the restricted body editor.
 */
export type StructuredTextBlock =
  | ParagraphInput
  | StructuredListBlock
  | StructuredImageBlock
  | StructuredToolBlock
  | StructuredEquationBlock
  | ProcessEquationBlock

export type StructuredBodyValue = StructuredTextBlock[]
