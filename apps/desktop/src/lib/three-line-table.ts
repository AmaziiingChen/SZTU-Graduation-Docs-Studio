export type ParsedTable = {
  rows: string[][]
  errors: string[]
}

const MAX_COLUMNS = 12
const MAX_ROWS = 200

function parseDelimitedText(source: string, delimiter: "\t" | ","): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    const next = source[index + 1]

    if (character === '"') {
      if (quoted && next === '"') {
        cell += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === delimiter && !quoted) {
      row.push(cell.trim())
      cell = ""
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1
      row.push(cell.trim())
      rows.push(row)
      row = []
      cell = ""
    } else {
      cell += character
    }
  }

  row.push(cell.trim())
  rows.push(row)
  while (rows.length > 0 && rows.at(-1)?.every((value) => value === "")) rows.pop()
  return rows
}

export function parseTableText(source: string): ParsedTable {
  if (!source.trim()) return { rows: [], errors: [] }

  const delimiter = source.includes("\t") ? "\t" : ","
  const rows = parseDelimitedText(source, delimiter)
  const errors: string[] = []
  const columnCount = rows[0]?.length ?? 0

  if (columnCount < 2) errors.push("表格至少需要两列。请从 Excel/WPS 复制多列数据，或使用英文逗号分隔。")
  if (rows.length < 2) errors.push("表格至少需要一行表头和一行数据。")
  if (columnCount > MAX_COLUMNS) errors.push(`表格最多支持 ${MAX_COLUMNS} 列。`)
  if (rows.length > MAX_ROWS) errors.push(`表格最多支持 ${MAX_ROWS} 行（含表头）。`)
  if (rows[0]?.some((value) => value === "")) errors.push("表头中不能有空白单元格。")

  const unevenRow = rows.findIndex((item) => item.length !== columnCount)
  if (unevenRow >= 0) {
    errors.push(`第 ${unevenRow + 1} 行有 ${rows[unevenRow].length} 列，应为 ${columnCount} 列。`)
  }

  return { rows, errors }
}

export function escapeLatex(value: string): string {
  const replacements: Record<string, string> = {
    "\\": "\\textbackslash{}",
    "{": "\\{",
    "}": "\\}",
    "$": "\\$",
    "&": "\\&",
    "#": "\\#",
    "%": "\\%",
    "_": "\\_",
    "~": "\\textasciitilde{}",
    "^": "\\textasciicircum{}",
  }
  return value.replace(/[\\{}$&#%_~^]/g, (character) => replacements[character])
}

export function generateThreeLineTableLatex({
  rows,
  caption,
  label,
}: {
  rows: string[][]
  caption?: string
  label?: string
}): string {
  if (rows.length < 2 || rows[0].length < 2) return ""

  const alignment = `l${"c".repeat(rows[0].length - 1)}`
  const renderRow = (row: string[]) => `${row.map(escapeLatex).join(" & ")} \\\\`
  const lines = ["\\begin{table}[htbp]", "  \\centering"]
  if (caption?.trim()) lines.push(`  \\caption{${escapeLatex(caption.trim())}}`)
  if (label?.trim()) lines.push(`  \\label{${escapeLatex(label.trim())}}`)
  lines.push(
    `  \\begin{tabular}{${alignment}}`,
    "    \\toprule",
    `    ${renderRow(rows[0])}`,
    "    \\midrule",
    ...rows.slice(1).map((row) => `    ${renderRow(row)}`),
    "    \\bottomrule",
    "  \\end{tabular}",
    "\\end{table}",
  )
  return lines.join("\n")
}
