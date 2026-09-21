import { DownloadIcon as DownloadIconAnimated } from "@/components/ui/download"
import { CopyIcon as CopyIconAnimated } from "@/components/ui/copy"
import { AnimatedActionIcon } from "@/components/workbench/animated-action-icon"
import { useActionFeedback } from "@/hooks/use-action-feedback"
import { ActionFeedbackIcon } from "@/components/workbench/action-feedback-icon"
import { ImageIcon } from "@/components/ui/image-icon"
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
import { writeClipboardText } from "@/lib/desktop-clipboard"
import {
  copyTablePreviewPng,
  downloadTablePreviewPng,
  type TablePreviewImageStyle,
} from "@/lib/table-preview-image"
import { cn } from "@/lib/utils"

type TableAlignment = "left" | "center" | "right"

const alignmentClasses: Record<TableAlignment, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
}

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
    reset("copyPng")
    try {
      await copyTablePreviewPng(imageOptions)
      complete("copyPng")
      toast.success("表格 PNG 已复制，可直接粘贴到其他应用。")
    } catch {
      toast.error("当前系统无法直接复制图片，请使用“下载 PNG”。")
    }
  }

  const downloadPng = async () => {
    reset("downloadPng")
    try {
      await downloadTablePreviewPng(imageOptions, pngFilename)
      complete("downloadPng")
      toast.success("文件已准备好，已请求下载 PNG。")
    } catch {
      toast.error("PNG 生成失败，请检查表格内容后重试。")
    }
  }

  const { completed, complete, reset } = useActionFeedback()

  const copyLatex = async () => {
    reset("copyLatex")
    if (!latex) return
    try {
      await writeClipboardText(latex)
      complete("copyLatex")
      toast.success("LaTeX 源码已复制。")
    } catch {
      toast.error("无法访问剪贴板，请在“查看 LaTeX”中手动复制。")
    }
  }

  const downloadLatex = () => {
    reset("downloadLatex")
    if (!latex) return
    const blob = new Blob([latex], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = filename
    anchor.click()
    complete("downloadLatex")
    toast.success("文件已准备好，已请求下载。")
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
            <ActionFeedbackIcon token={completed.copyPng}><AnimatedActionIcon icon={ImageIcon} /></ActionFeedbackIcon>
            复制 PNG
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={!valid} onClick={() => void downloadPng()}>
            <ActionFeedbackIcon token={completed.downloadPng}><AnimatedActionIcon icon={DownloadIconAnimated} /></ActionFeedbackIcon>
            下载 PNG
          </Button>
          <LatexSourceSheet latex={latex} packages={packages} />
          <Button type="button" size="sm" variant="outline" disabled={!latex} onClick={() => void copyLatex()}>
            <ActionFeedbackIcon token={completed.copyLatex}><AnimatedActionIcon icon={CopyIconAnimated} /></ActionFeedbackIcon>
            复制源码
          </Button>
          <Button type="button" size="sm" disabled={!latex} onClick={downloadLatex}>
            <ActionFeedbackIcon token={completed.downloadLatex}><AnimatedActionIcon icon={DownloadIconAnimated} /></ActionFeedbackIcon>
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
                          className={cn(
                            "whitespace-normal",
                            variant === "grid" && "border",
                            alignmentClasses[alignments[cellIndex] ?? (cellIndex === 0 ? "left" : "center")],
                          )}
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
                        className={cn(
                          "whitespace-normal",
                          variant === "grid" && "border",
                          alignmentClasses[alignments[cellIndex] ?? (cellIndex === 0 ? "left" : "center")],
                        )}
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
