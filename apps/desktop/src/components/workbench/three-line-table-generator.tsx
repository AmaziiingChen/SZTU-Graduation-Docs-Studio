import { useMemo } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SaveStatusBadge } from "@/components/workbench/save-status-badge"
import { TablePreviewCard } from "@/components/workbench/table-preview-card"
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
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="three-line-table-title" className="text-xl font-semibold">三线表生成器</h2>
              <SaveStatusBadge state={saveState} />
            </div>
            <p className="text-sm text-muted-foreground">
              粘贴 Excel、WPS 表格或 CSV 数据，生成可直接放入论文的 booktabs 源码。
            </p>
          </div>
          <ToolDraftActions saveState={saveState} draftName="三线表" onClear={clearDraft} showSaveStatus={false} />
        </div>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>表格数据</CardTitle>
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

          <TablePreviewCard
            rows={valid ? parsed.rows : []}
            caption={caption}
            headerRows={1}
            variant="three-line"
            tableLabel="三线表预览"
            emptyText="创建表格并填写数据后在这里预览。"
            latex={latex}
            filename="three-line-table.tex"
            pngFilename="three-line-table.png"
            packages={["booktabs"]}
          />
        </div>
      </main>
    </ScrollArea>
  )
}
