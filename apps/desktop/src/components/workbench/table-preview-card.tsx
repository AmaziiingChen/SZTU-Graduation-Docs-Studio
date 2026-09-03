import { ImageIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { LatexSourceSheet } from "@/components/workbench/latex-source-sheet"
import { cn } from "@/lib/utils"
import { copyTablePreviewPng, type TablePreviewImageStyle } from "@/lib/table-preview-image"

type TableAlignment = "left" | "center" | "right"

export function TablePreviewCard({
  rows,
  caption,
  headerRows,
  alignments = [],
  variant,
  tableLabel,
  description,
  emptyText,
  latex,
  filename,
  packages,
}: {
  rows: string[][]
  caption: string
  headerRows: number
  alignments?: TableAlignment[]
  variant: TablePreviewImageStyle
  tableLabel: string
  description: string
  emptyText: string
  latex: string
  filename: string
  packages: string[]
}) {
  const valid = rows.length > 0

  const copyPng = async () => {
    try {
      await copyTablePreviewPng({ rows, caption, headerRows, alignments, style: variant })
      toast.success("表格 PNG 已复制，可直接粘贴到其他应用。")
    } catch {
      toast.error("无法复制 PNG，请检查系统剪贴板权限后重试。")
    }
  }

  return (
    <Card>
      <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle>表格预览</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={!valid} onClick={() => void copyPng()}>
            <ImageIcon />
            复制 PNG
          </Button>
          <LatexSourceSheet latex={latex} filename={filename} packages={packages} />
        </div>
      </CardHeader>
      <CardContent>
        {valid ? (
          <div className="overflow-x-auto rounded-lg border bg-background p-6">
            {caption.trim() ? <p className="mb-4 text-center text-sm font-medium">{caption.trim()}</p> : null}
            <Table
              aria-label={tableLabel}
              className={cn(
                variant === "three-line" ? "border-y-2" : "border-collapse border",
              )}
            >
              {headerRows > 0 ? (
                <TableHeader>
                  {rows.slice(0, headerRows).map((row, rowIndex) => (
                    <TableRow key={rowIndex} className={cn(variant === "three-line" && "border-b")}>
                      {row.map((cell, cellIndex) => (
                        <TableHead
                          key={cellIndex}
                          className={cn("whitespace-normal", variant === "grid" && "border")}
                          style={{ textAlign: alignments[cellIndex] ?? (cellIndex === 0 ? "left" : "center") }}
                        >
                          {cell}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
              ) : null}
              <TableBody>
                {rows.slice(headerRows).map((row, rowIndex) => (
                  <TableRow key={rowIndex} className={cn(variant === "three-line" && "border-0 hover:bg-transparent")}>
                    {row.map((cell, cellIndex) => (
                      <TableCell
                        key={cellIndex}
                        className={cn("whitespace-normal", variant === "grid" && "border")}
                        style={{ textAlign: alignments[cellIndex] ?? (cellIndex === 0 ? "left" : "center") }}
                      >
                        {cell}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {emptyText}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
