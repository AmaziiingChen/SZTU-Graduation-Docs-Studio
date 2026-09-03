import { useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react"
import {
  Columns3Icon,
  Grid3X3Icon,
  Rows3Icon,
  SheetIcon,
  Trash2Icon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { parseTableText } from "@/lib/three-line-table"

const PICKER_MIN_ROWS = 2
const PICKER_MIN_COLUMNS = 2
const PICKER_MAX_ROWS = 8
const PICKER_MAX_COLUMNS = 10
const MAX_ROWS = 200
const MAX_COLUMNS = 12

export type EditableTableValue = {
  source: string
  rowCount?: number
  columnCount?: number
}

function createMatrix(rowCount: number, columnCount: number): string[][] {
  return Array.from({ length: rowCount }, () => Array.from({ length: columnCount }, () => ""))
}

function serializeRows(rows: string[][]): string {
  return rows.map((row) => row.join("\t")).join("\n")
}

function editableTableRows(value: EditableTableValue): string[][] {
  const parsedRows = parseTableText(value.source).rows
  const rowCount = Math.max(value.rowCount ?? 0, parsedRows.length)
  const parsedColumnCount = parsedRows.reduce((largest, row) => Math.max(largest, row.length), 0)
  const columnCount = Math.max(value.columnCount ?? 0, parsedColumnCount)
  if (rowCount === 0 || columnCount === 0) return []

  return Array.from({ length: rowCount }, (_, rowIndex) =>
    Array.from({ length: columnCount }, (_, columnIndex) =>
      parsedRows[rowIndex]?.[columnIndex] ?? "",
    ),
  )
}

function columnName(index: number): string {
  let value = index + 1
  let name = ""
  while (value > 0) {
    value -= 1
    name = String.fromCharCode(65 + (value % 26)) + name
    value = Math.floor(value / 26)
  }
  return name
}

export function VisualTableEditor({
  value,
  onChange,
  exampleData,
  headerRows = 1,
}: {
  value: EditableTableValue
  onChange: (next: EditableTableValue) => void
  exampleData: string
  headerRows?: number
}) {
  const rows = useMemo(() => editableTableRows(value), [value])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [hoveredSize, setHoveredSize] = useState({ rows: 3, columns: 3 })
  const [selectedCell, setSelectedCell] = useState<{ row: number; column: number } | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteSource, setPasteSource] = useState("")
  const cellRefs = useRef(new Map<string, HTMLInputElement>())
  const parsedPaste = useMemo(() => parseTableText(pasteSource), [pasteSource])

  const commitRows = (nextRows: string[][]) => {
    onChange({
      source: serializeRows(nextRows),
      rowCount: nextRows.length,
      columnCount: nextRows[0]?.length ?? 0,
    })
  }

  const createTable = (rowCount: number, columnCount: number) => {
    const current = rows.length > 0 ? rows : createMatrix(rowCount, columnCount)
    const resized = Array.from({ length: rowCount }, (_, rowIndex) =>
      Array.from({ length: columnCount }, (_, columnIndex) =>
        current[rowIndex]?.[columnIndex] ?? "",
      ),
    )
    commitRows(resized)
    setSelectedCell({ row: 0, column: 0 })
    setPickerOpen(false)
    requestAnimationFrame(() => cellRefs.current.get("0-0")?.focus())
  }

  const updateCell = (rowIndex: number, columnIndex: number, content: string) => {
    const next = rows.map((row) => [...row])
    next[rowIndex][columnIndex] = content
    commitRows(next)
  }

  const focusCell = (row: number, column: number) => {
    setSelectedCell({ row, column })
    requestAnimationFrame(() => cellRefs.current.get(`${row}-${column}`)?.focus())
  }

  const insertRow = () => {
    if (rows.length >= MAX_ROWS) return
    const index = selectedCell ? selectedCell.row + 1 : rows.length
    const next = rows.map((row) => [...row])
    next.splice(index, 0, Array.from({ length: rows[0].length }, () => ""))
    commitRows(next)
    focusCell(index, selectedCell?.column ?? 0)
  }

  const insertColumn = () => {
    if ((rows[0]?.length ?? 0) >= MAX_COLUMNS) return
    const index = selectedCell ? selectedCell.column + 1 : rows[0].length
    const next = rows.map((row) => {
      const updated = [...row]
      updated.splice(index, 0, "")
      return updated
    })
    commitRows(next)
    focusCell(selectedCell?.row ?? 0, index)
  }

  const deleteRow = () => {
    if (!selectedCell || rows.length <= 2) return
    const next = rows.filter((_, index) => index !== selectedCell.row)
    commitRows(next)
    focusCell(Math.min(selectedCell.row, next.length - 1), selectedCell.column)
  }

  const deleteColumn = () => {
    if (!selectedCell || rows[0].length <= 2) return
    const next = rows.map((row) => row.filter((_, index) => index !== selectedCell.column))
    commitRows(next)
    focusCell(selectedCell.row, Math.min(selectedCell.column, next[0].length - 1))
  }

  const applyBlock = (block: string[][], startRow = 0, startColumn = 0) => {
    if (block.length === 0 || block[0].length === 0) return
    const rowCount = Math.min(MAX_ROWS, Math.max(rows.length, startRow + block.length))
    const columnCount = Math.min(
      MAX_COLUMNS,
      Math.max(rows[0]?.length ?? 0, startColumn + Math.max(...block.map((row) => row.length))),
    )
    const next = Array.from({ length: rowCount }, (_, rowIndex) =>
      Array.from({ length: columnCount }, (_, columnIndex) =>
        rows[rowIndex]?.[columnIndex] ?? "",
      ),
    )
    block.forEach((row, rowOffset) => {
      row.forEach((cell, columnOffset) => {
        const targetRow = startRow + rowOffset
        const targetColumn = startColumn + columnOffset
        if (targetRow < rowCount && targetColumn < columnCount) next[targetRow][targetColumn] = cell
      })
    })
    commitRows(next)
  }

  const handleCellPaste = (
    event: ClipboardEvent<HTMLInputElement>,
    rowIndex: number,
    columnIndex: number,
  ) => {
    const pasted = event.clipboardData.getData("text/plain")
    if (!pasted.includes("\t") && !/[\r\n]/.test(pasted)) return
    event.preventDefault()
    applyBlock(parseTableText(pasted).rows, rowIndex, columnIndex)
  }

  const handleCellKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    rowIndex: number,
    columnIndex: number,
  ) => {
    if (event.key === "Enter") {
      event.preventDefault()
      if (rowIndex < rows.length - 1) focusCell(rowIndex + 1, columnIndex)
      else if (rows.length < MAX_ROWS) insertRow()
      return
    }
    if (event.key !== "Tab") return
    const total = rows.length * rows[0].length
    const current = rowIndex * rows[0].length + columnIndex
    const target = current + (event.shiftKey ? -1 : 1)
    if (target < 0 || target >= total) return
    event.preventDefault()
    focusCell(Math.floor(target / rows[0].length), target % rows[0].length)
  }

  const selectedPosition = selectedCell
    ? `${columnName(selectedCell.column)}${selectedCell.row + 1}`
    : "未选择单元格"

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger render={<Button type="button" variant={rows.length > 0 ? "outline" : "default"} size="sm" />}>
            <Grid3X3Icon />
            {rows.length > 0 ? "调整行列" : "新建表格"}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto">
            <div className="grid gap-3">
              <p className="text-sm font-medium">
                {hoveredSize.rows} 行 × {hoveredSize.columns} 列
              </p>
              <div
                className="grid gap-1"
                style={{ gridTemplateColumns: `repeat(${PICKER_MAX_COLUMNS - PICKER_MIN_COLUMNS + 1}, minmax(0, 1fr))` }}
                onPointerLeave={() => setHoveredSize({ rows: 3, columns: 3 })}
              >
                {Array.from({
                  length: (PICKER_MAX_ROWS - PICKER_MIN_ROWS + 1) *
                    (PICKER_MAX_COLUMNS - PICKER_MIN_COLUMNS + 1),
                }, (_, index) => {
                  const pickerColumns = PICKER_MAX_COLUMNS - PICKER_MIN_COLUMNS + 1
                  const row = Math.floor(index / pickerColumns) + PICKER_MIN_ROWS
                  const column = (index % pickerColumns) + PICKER_MIN_COLUMNS
                  const selected = row <= hoveredSize.rows && column <= hoveredSize.columns
                  return (
                    <button
                      key={`${row}-${column}`}
                      type="button"
                      className={`size-5 rounded-sm border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-primary bg-primary" : "bg-background hover:bg-muted"}`}
                      aria-label={`创建 ${row} 行 ${column} 列表格`}
                      onPointerEnter={() => setHoveredSize({ rows: row, columns: column })}
                      onFocus={() => setHoveredSize({ rows: row, columns: column })}
                      onClick={() => createTable(row, column)}
                    />
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground">最多可在这里选择 8 行 × 10 列，创建后仍可继续增加。</p>
            </div>
          </PopoverContent>
        </Popover>

        <Button type="button" variant="outline" size="sm" onClick={() => setPasteOpen(true)}>
          <SheetIcon />
          从 Excel/WPS 粘贴
        </Button>
        {rows.length > 0 ? (
          <>
            <Button type="button" variant="outline" size="sm" onClick={insertRow} disabled={rows.length >= MAX_ROWS}>
              <Rows3Icon />
              插入行
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={insertColumn} disabled={rows[0].length >= MAX_COLUMNS}>
              <Columns3Icon />
              插入列
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={deleteRow} disabled={!selectedCell || rows.length <= 2}>
              <Trash2Icon />
              删除行
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={deleteColumn} disabled={!selectedCell || rows[0].length <= 2}>
              <Trash2Icon />
              删除列
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">{selectedPosition}</span>
          </>
        ) : null}
      </div>

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border" role="grid" aria-label="表格内容编辑区">
          <div
            className="grid w-full"
            style={{ gridTemplateColumns: `2.5rem repeat(${rows[0].length}, minmax(6rem, 1fr))` }}
          >
            <div className="sticky left-0 z-20 border-b border-r bg-muted" aria-hidden="true" />
            {rows[0].map((_, columnIndex) => (
              <div
                key={`column-${columnIndex}`}
                className={`flex h-8 items-center justify-center border-b border-r text-xs font-medium text-muted-foreground last:border-r-0 ${selectedCell?.column === columnIndex ? "bg-accent text-accent-foreground" : "bg-muted"}`}
                role="columnheader"
              >
                {columnName(columnIndex)}
              </div>
            ))}
            {rows.flatMap((row, rowIndex) => [
              <div
                key={`row-${rowIndex}`}
                className={`sticky left-0 z-10 flex h-10 items-center justify-center border-b border-r text-xs font-medium text-muted-foreground ${selectedCell?.row === rowIndex ? "bg-accent text-accent-foreground" : "bg-muted"}`}
                role="rowheader"
              >
                {rowIndex + 1}
              </div>,
              ...row.map((cell, columnIndex) => (
                <div
                  key={`cell-${rowIndex}-${columnIndex}`}
                  role="gridcell"
                  className={`border-b border-r last:border-r-0 ${rowIndex < headerRows ? "bg-muted/40" : "bg-background"}`}
                >
                  <Input
                    ref={(element) => {
                      const key = `${rowIndex}-${columnIndex}`
                      if (element) cellRefs.current.set(key, element)
                      else cellRefs.current.delete(key)
                    }}
                    value={cell}
                    aria-label={`${columnName(columnIndex)}${rowIndex + 1}`}
                    className="h-10 rounded-none border-0 px-3 shadow-none focus-visible:z-10 focus-visible:ring-2"
                    onFocus={() => setSelectedCell({ row: rowIndex, column: columnIndex })}
                    onChange={(event) => updateCell(rowIndex, columnIndex, event.target.value)}
                    onPaste={(event) => handleCellPaste(event, rowIndex, columnIndex)}
                    onKeyDown={(event) => handleCellKeyDown(event, rowIndex, columnIndex)}
                  />
                </div>
              )),
            ])}
          </div>
        </div>
      ) : (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center">
          <Grid3X3Icon className="size-8 text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-sm font-medium">先选择表格的行数和列数</p>
            <p className="text-xs text-muted-foreground">也可以直接粘贴从 Excel 或 WPS 复制的整块数据。</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Tab / Shift+Tab 切换单元格</span>
        <span>Enter 移到下一行</span>
        <span>支持整块粘贴</span>
      </div>

      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>从 Excel 或 WPS 粘贴</DialogTitle>
            <DialogDescription>复制需要的单元格区域，然后粘贴到下面。</DialogDescription>
          </DialogHeader>
          <Textarea
            value={pasteSource}
            onChange={(event) => setPasteSource(event.target.value)}
            placeholder={exampleData}
            className="min-h-48 resize-y text-sm"
            aria-label="批量粘贴数据"
          />
          {pasteSource.trim() && parsedPaste.errors.length > 0 ? (
            <p className="text-sm text-destructive">{parsedPaste.errors[0]}</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPasteSource(exampleData)}>填入示例</Button>
            <Button
              type="button"
              disabled={parsedPaste.rows.length === 0 || parsedPaste.errors.length > 0}
              onClick={() => {
                const pastedRows = parsedPaste.rows
                onChange({
                  source: serializeRows(pastedRows),
                  rowCount: pastedRows.length,
                  columnCount: Math.max(...pastedRows.map((row) => row.length)),
                })
                setPasteSource("")
                setPasteOpen(false)
              }}
            >
              生成表格
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
