import { useMemo } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { LatexSourceCard } from "@/components/workbench/latex-source-card"
import { ToolDraftActions } from "@/components/workbench/tool-draft-actions"
import { VisualTableEditor } from "@/components/workbench/visual-table-editor"
import {
  generateThreeLineTableLatex,
  parseTableText,
} from "@/lib/three-line-table"
import { useLocalDraft } from "@/lib/use-local-draft"

const exampleData = "指标\t实验组\t对照组\n准确率（%）\t92.4\t86.1\n耗时（s）\t12.8\t15.3"
const storageKey = "sztu-docs.thesis-tools.three-line-table.v1"
const initialDraft: {
  caption: string
  label: string
  source: string
  rowCount?: number
  columnCount?: number
} = { caption: "", label: "", source: "" }

function isThreeLineTableDraft(value: unknown): value is typeof initialDraft {
  if (!value || typeof value !== "object") return false
  const draft = value as Record<string, unknown>
  return typeof draft.caption === "string" &&
    typeof draft.label === "string" &&
    typeof draft.source === "string" &&
    (draft.rowCount === undefined || typeof draft.rowCount === "number") &&
    (draft.columnCount === undefined || typeof draft.columnCount === "number")
}

export function ThreeLineTableGenerator() {
  const { value: draft, setValue: setDraft, saveState, clearDraft } = useLocalDraft({
    storageKey,
    initialValue: initialDraft,
    isValid: isThreeLineTableDraft,
  })
  const { caption, label, source, rowCount, columnCount } = draft
  const parsed = useMemo(() => parseTableText(source), [source])
  const valid = parsed.rows.length > 0 && parsed.errors.length === 0
  const latex = useMemo(
    () =>
      valid
        ? generateThreeLineTableLatex({ rows: parsed.rows, caption, label })
        : "",
    [caption, label, parsed.rows, valid],
  )

  return (
    <ScrollArea className="h-full">
      <main className="mx-auto grid w-full max-w-6xl gap-6 p-6" aria-labelledby="three-line-table-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 id="three-line-table-title" className="text-xl font-semibold">三线表生成器</h2>
            <p className="text-sm text-muted-foreground">
              粘贴 Excel、WPS 表格或 CSV 数据，生成可直接放入论文的 booktabs 源码。
            </p>
          </div>
          <ToolDraftActions saveState={saveState} draftName="三线表" onClear={clearDraft} />
        </div>

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
          <Card>
            <CardHeader>
              <CardTitle>表格数据</CardTitle>
              <CardDescription>首行作为表头；从电子表格复制时会自动识别列。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-medium">
                  表题（可选）
                  <Input
                    value={caption}
                    onChange={(event) => setDraft((current) => ({ ...current, caption: event.target.value }))}
                    placeholder="例如：不同方法的实验结果"
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  引用标签（可选）
                  <Input
                    value={label}
                    onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
                    placeholder="例如：tab:experiment"
                  />
                </label>
              </div>
              <VisualTableEditor
                value={{ source, rowCount, columnCount }}
                exampleData={exampleData}
                onChange={(next) => setDraft((current) => ({ ...current, ...next }))}
              />
              {parsed.errors.length > 0 ? (
                <Alert variant="destructive">
                  <AlertTitle>数据暂时无法生成</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc space-y-1 pl-4">
                      {parsed.errors.map((error) => <li key={error}>{error}</li>)}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>表格预览</CardTitle>
              <CardDescription>预览使用与源码相同的数据结构，不代表论文最终字号与分页。</CardDescription>
            </CardHeader>
            <CardContent>
              {valid ? (
                <div className="rounded-lg border p-4">
                  {caption.trim() ? <p className="mb-3 text-center text-sm font-medium">{caption.trim()}</p> : null}
                  <Table aria-label="三线表预览" className="border-y-2">
                    <TableHeader>
                      <TableRow className="border-b">
                        {parsed.rows[0].map((cell, index) => (
                          <TableHead key={`${cell}-${index}`} className={index === 0 ? "whitespace-normal" : "text-center whitespace-normal"}>
                            {cell}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsed.rows.slice(1).map((row, rowIndex) => (
                        <TableRow key={rowIndex} className="border-0 hover:bg-transparent">
                          {row.map((cell, cellIndex) => (
                            <TableCell key={cellIndex} className={cellIndex === 0 ? "whitespace-normal" : "text-center whitespace-normal"}>
                              {cell}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="flex min-h-56 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  粘贴至少两列数据后在这里预览。
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <LatexSourceCard
          latex={latex}
          filename="three-line-table.tex"
          packages={["booktabs"]}
        />
      </main>
    </ScrollArea>
  )
}
