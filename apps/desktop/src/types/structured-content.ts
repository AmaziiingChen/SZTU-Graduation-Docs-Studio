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

/**
 * Contract blocks supported by the restricted body editor.
 */
export type StructuredTextBlock =
  | ParagraphInput
  | StructuredListBlock
  | StructuredImageBlock

export type StructuredBodyValue = StructuredTextBlock[]
