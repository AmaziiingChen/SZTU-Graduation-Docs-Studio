import { writeClipboardPng } from "@/lib/desktop-clipboard"

export type TablePreviewImageStyle = "three-line" | "grid"

export type TablePreviewImageOptions = {
  rows: string[][]
  caption?: string
  headerRows: number
  alignments?: Array<"left" | "center" | "right">
  style: TablePreviewImageStyle
}

const MAX_COLUMN_WIDTH = 260
const MIN_COLUMN_WIDTH = 96
const CELL_HORIZONTAL_PADDING = 16
const CELL_VERTICAL_PADDING = 10
const LINE_HEIGHT = 24
const IMAGE_PADDING = 32
const MAX_TABLE_WIDTH = 1200
const IMAGE_SCALE = 2
// Exported previews represent a paper document, so their colors stay independent of the app theme.
const PAPER_COLOR = "white"
const INK_COLOR = "black"

function wrapText(context: CanvasRenderingContext2D, value: string, maxWidth: number): string[] {
  if (!value) return [""]
  const lines: string[] = []
  let current = ""
  for (const character of Array.from(value)) {
    const candidate = `${current}${character}`
    if (current && context.measureText(candidate).width > maxWidth) {
      lines.push(current)
      current = character
    } else {
      current = candidate
    }
  }
  lines.push(current)
  return lines
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error("PNG image could not be created"))
    }, "image/png")
  })
}

export async function renderTablePreviewPng({
  rows,
  caption = "",
  headerRows,
  alignments = [],
  style,
}: TablePreviewImageOptions): Promise<Blob> {
  if (rows.length === 0 || rows[0]?.length === 0) throw new Error("Table data is empty")

  const columnCount = rows[0].length
  const measurementCanvas = document.createElement("canvas")
  const measurementContext = measurementCanvas.getContext("2d")
  if (!measurementContext) throw new Error("Canvas is unavailable")
  measurementContext.font = '14px "Songti SC", "SimSun", serif'

  let columnWidths = Array.from({ length: columnCount }, (_, columnIndex) => {
    const contentWidth = Math.max(
      ...rows.map((row) => measurementContext.measureText(row[columnIndex] ?? "").width),
    )
    return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, contentWidth + CELL_HORIZONTAL_PADDING * 2))
  })
  const measuredWidth = columnWidths.reduce((sum, width) => sum + width, 0)
  if (measuredWidth > MAX_TABLE_WIDTH) {
    const ratio = MAX_TABLE_WIDTH / measuredWidth
    columnWidths = columnWidths.map((width) => Math.max(72, width * ratio))
  }

  const wrappedRows = rows.map((row) => row.map((cell, columnIndex) =>
    wrapText(measurementContext, cell ?? "", columnWidths[columnIndex] - CELL_HORIZONTAL_PADDING * 2),
  ))
  const rowHeights = wrappedRows.map((row) =>
    Math.max(...row.map((lines) => lines.length)) * LINE_HEIGHT + CELL_VERTICAL_PADDING * 2,
  )
  const tableWidth = columnWidths.reduce((sum, width) => sum + width, 0)
  const captionHeight = caption.trim() ? 44 : 0
  const tableHeight = rowHeights.reduce((sum, height) => sum + height, 0)
  const width = Math.ceil(tableWidth + IMAGE_PADDING * 2)
  const height = Math.ceil(tableHeight + captionHeight + IMAGE_PADDING * 2)

  const canvas = document.createElement("canvas")
  canvas.width = width * IMAGE_SCALE
  canvas.height = height * IMAGE_SCALE
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Canvas is unavailable")
  context.scale(IMAGE_SCALE, IMAGE_SCALE)
  context.fillStyle = PAPER_COLOR
  context.fillRect(0, 0, width, height)
  context.fillStyle = INK_COLOR
  context.textBaseline = "middle"

  if (caption.trim()) {
    context.font = '600 16px "Songti SC", "SimSun", serif'
    context.textAlign = "center"
    context.fillText(caption.trim(), width / 2, IMAGE_PADDING + 12)
  }

  const tableTop = IMAGE_PADDING + captionHeight
  let y = tableTop
  wrappedRows.forEach((row, rowIndex) => {
    let x = IMAGE_PADDING
    row.forEach((lines, columnIndex) => {
      const columnWidth = columnWidths[columnIndex]
      const alignment = alignments[columnIndex] ?? (columnIndex === 0 ? "left" : "center")
      context.font = `${rowIndex < headerRows ? "600 " : ""}14px "Songti SC", "SimSun", serif`
      context.textAlign = alignment
      const textX = alignment === "left"
        ? x + CELL_HORIZONTAL_PADDING
        : alignment === "right"
          ? x + columnWidth - CELL_HORIZONTAL_PADDING
          : x + columnWidth / 2
      const contentHeight = lines.length * LINE_HEIGHT
      const firstLineY = y + (rowHeights[rowIndex] - contentHeight) / 2 + LINE_HEIGHT / 2
      lines.forEach((line, lineIndex) => context.fillText(line, textX, firstLineY + lineIndex * LINE_HEIGHT))
      x += columnWidth
    })
    y += rowHeights[rowIndex]
  })

  context.strokeStyle = INK_COLOR
  if (style === "grid") {
    context.lineWidth = 1
    let gridX = IMAGE_PADDING
    context.beginPath()
    columnWidths.forEach((columnWidth) => {
      context.moveTo(gridX, tableTop)
      context.lineTo(gridX, tableTop + tableHeight)
      gridX += columnWidth
    })
    context.moveTo(gridX, tableTop)
    context.lineTo(gridX, tableTop + tableHeight)
    let gridY = tableTop
    context.moveTo(IMAGE_PADDING, gridY)
    context.lineTo(IMAGE_PADDING + tableWidth, gridY)
    rowHeights.forEach((rowHeight) => {
      gridY += rowHeight
      context.moveTo(IMAGE_PADDING, gridY)
      context.lineTo(IMAGE_PADDING + tableWidth, gridY)
    })
    context.stroke()
  } else {
    const headerBottom = tableTop + rowHeights.slice(0, Math.max(1, headerRows)).reduce((sum, height) => sum + height, 0)
    ;[
      { y: tableTop, width: 2 },
      { y: headerBottom, width: 1 },
      { y: tableTop + tableHeight, width: 2 },
    ].forEach((rule) => {
      context.beginPath()
      context.lineWidth = rule.width
      context.moveTo(IMAGE_PADDING, rule.y)
      context.lineTo(IMAGE_PADDING + tableWidth, rule.y)
      context.stroke()
    })
  }

  return canvasBlob(canvas)
}

export async function copyTablePreviewPng(options: TablePreviewImageOptions): Promise<void> {
  const blob = await renderTablePreviewPng(options)
  await writeClipboardPng(blob)
}

export async function downloadTablePreviewPng(
  options: TablePreviewImageOptions,
  filename: string,
): Promise<void> {
  const blob = await renderTablePreviewPng(options)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
