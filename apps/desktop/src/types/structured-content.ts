export type StructuredScript = "normal" | "sub" | "super"

export type StructuredRun = {
  text: string
  script?: StructuredScript
  italic?: boolean
  bold?: boolean
}

export type RichParagraph = {
  type?: "paragraph"
  runs: StructuredRun[]
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
export type StructuredToolBlock = StructuredFigureGroupBlock | StructuredDataTableBlock

/**
 * Contract blocks supported by the restricted body editor.
 */
export type StructuredTextBlock =
  | ParagraphInput
  | StructuredListBlock
  | StructuredImageBlock
  | StructuredToolBlock

export type StructuredBodyValue = StructuredTextBlock[]
