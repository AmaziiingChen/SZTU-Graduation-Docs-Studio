import { escapeLatex } from "@/lib/three-line-table"

export type TableColumnAlignment = "left" | "center" | "right"
export type GeneralTableMode = "natural" | "page_width" | "long_table"

const naturalAlignment: Record<TableColumnAlignment, string> = {
  left: "l",
  center: "c",
  right: "r",
}

const flexibleAlignment: Record<TableColumnAlignment, string> = {
  left: ">{\\raggedright\\arraybackslash}X",
  center: ">{\\centering\\arraybackslash}X",
  right: ">{\\raggedleft\\arraybackslash}X",
}

function renderCell(value: string, header: boolean): string {
  const escaped = escapeLatex(value)
  return header ? `\\textbf{${escaped}}` : escaped
}

function renderRows(rows: string[][], headerRows: number, includeRules: boolean): string[] {
  return rows.flatMap((row, rowIndex) => {
    const line = `${row.map((cell) => renderCell(cell, rowIndex < headerRows)).join(" & ")} \\\\`
    return includeRules ? [line, "\\hline"] : [line]
  })
}

export function generateGeneralTableLatex({
  rows,
  caption,
  label,
  headerRows = 1,
  mode = "natural",
  alignments,
}: {
  rows: string[][]
  caption?: string
  label?: string
  headerRows?: number
  mode?: GeneralTableMode
  alignments?: TableColumnAlignment[]
}): string {
  const columnCount = rows[0]?.length ?? 0
  if (rows.length === 0 || columnCount < 2) return ""

  const normalizedAlignments = Array.from(
    { length: columnCount },
    (_, index) => alignments?.[index] ?? (index === 0 ? "left" : "center"),
  )
  const boundedHeaderRows = Math.max(0, Math.min(headerRows, rows.length))
  const title = caption?.trim()
  const reference = label?.trim()

  if (mode === "long_table") {
    const columnSpec = `|${normalizedAlignments.map((item) => naturalAlignment[item]).join("|")}|`
    const header = rows.slice(0, boundedHeaderRows)
    const body = rows.slice(boundedHeaderRows)
    const lines = [
      `\\begin{longtable}{${columnSpec}}`,
    ]
    if (title) lines.push(`  \\caption{${escapeLatex(title)}}${reference ? ` \\label{${escapeLatex(reference)}}` : ""} \\\\`)
    else if (reference) lines.push(`  \\label{${escapeLatex(reference)}}`)
    lines.push("  \\hline")
    if (header.length > 0) {
      lines.push(...renderRows(header, boundedHeaderRows, true).map((line) => `  ${line}`))
      lines.push("  \\endfirsthead", "  \\hline")
      lines.push(...renderRows(header, boundedHeaderRows, true).map((line) => `  ${line}`))
      lines.push("  \\endhead")
    }
    lines.push(...renderRows(body, 0, true).map((line) => `  ${line}`), "\\end{longtable}")
    return lines.join("\n")
  }

  const environment = mode === "page_width" ? "tabularx" : "tabular"
  const columnSpec = `|${normalizedAlignments
    .map((item) => mode === "page_width" ? flexibleAlignment[item] : naturalAlignment[item])
    .join("|")}|`
  const begin = mode === "page_width"
    ? `  \\begin{tabularx}{\\textwidth}{${columnSpec}}`
    : `  \\begin{tabular}{${columnSpec}}`
  const lines = ["\\begin{table}[htbp]", "  \\centering"]
  if (title) lines.push(`  \\caption{${escapeLatex(title)}}`)
  if (reference) lines.push(`  \\label{${escapeLatex(reference)}}`)
  lines.push(
    begin,
    "    \\hline",
    ...renderRows(rows, boundedHeaderRows, true).map((line) => `    ${line}`),
    `  \\end{${environment}}`,
    "\\end{table}",
  )
  return lines.join("\n")
}

export function requiredPackagesForGeneralTable(mode: GeneralTableMode): string[] {
  if (mode === "page_width") return ["array", "tabularx"]
  if (mode === "long_table") return ["longtable"]
  return []
}
