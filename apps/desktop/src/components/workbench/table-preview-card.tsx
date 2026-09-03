import { CopyIcon, DownloadIcon, ImageDownIcon, ImageIcon } from "lucide-react"
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
import {
  copyTablePreviewPng,
  downloadTablePreviewPng,
  type TablePreviewImageStyle,
} from "@/lib/table-preview-image"

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
  pngFilename,
  packages,
}: {
  rows: string[][]
  caption: string
  headerRows: number
  alignments?: TableAlignment[]
  variant: TablePreviewImageStyle
  tableLabel: string
  description?: string
  emptyText: string
  latex: string
  filename: string
  pngFilename: string
  packages: string[]
}) {
  const valid = rows.length > 0
  const imageOptions = { rows, caption, headerRows, alignments, style: variant } as const

  const copyPng = async () => {
    try {
      await copyTablePreviewPng(imageOptions)
      toast.success("表格 PNG 已复制，可直接粘贴到其他应用。")
    } catch {
      toast.error("当前系统无法直接复制图片，请使用“下载 PNG”。")
    }
  }

  const downloadPng = async () => {
    try {
      await downloadTablePreviewPng(imageOptions, pngFilename)
      toast.success("表格 PNG 已下载。")
    } catch {
      toast.error("PNG 生成失败，请检查表格内容后重试。")
    }
  }

  const copyLatex = async () => {
    if (!latex) return
    try {
      await navigator.clipboard.writeText(latex)
      toast.success("LaTeX 源码已复制。")
    } catch {
      toast.error("无法访问剪贴板，请在“查看 LaTeX”中手动复制。")
    }
  }

  const downloadLatex = () => {
    if (!latex) return
    const blob = new Blob([latex], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card>
      <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle>表格预览</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={!valid} onClick={() => void copyPng()}>
            <ImageIcon />
            复制 PNG
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={!valid} onClick={() => void downloadPng()}>
            <ImageDownIcon />
            下载 PNG
          </Button>
          <LatexSourceSheet latex={latex} packages={packages} />
          <Button type="button" size="sm" variant="outline" disabled={!latex} onClick={() => void copyLatex()}>
            <CopyIcon />
            复制源码
          </Button>
          <Button type="button" size="sm" disabled={!latex} onClick={downloadLatex}>
            <DownloadIcon />
            下载源码
          </Button>
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
