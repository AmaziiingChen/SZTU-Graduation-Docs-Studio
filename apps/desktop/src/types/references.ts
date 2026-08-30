import type { RichParagraph } from "@/types/structured-content"

export type BibtexEntry = {
  id: string
  type: string
  citationKey: string
  fields: Record<string, string>
  raw: string
}

export type BibtexParseIssue = {
  code:
    | "syntax"
    | "duplicate_key"
    | "missing_field"
    | "unsupported_type"
    | "undefined_macro"
    | "macro_cycle"
    | "unsupported_command"
  message: string
  offset: number
  citationKey?: string
  field?: string
}

export type BibtexParseResult = {
  entries: BibtexEntry[]
  issues: BibtexParseIssue[]
}

export type FormattedReference = {
  id: string
  citationKey: string
  sourceType: string
  text: string
  paragraph: RichParagraph
}

export type FormattedBibtexResult = BibtexParseResult & {
  references: FormattedReference[]
}
