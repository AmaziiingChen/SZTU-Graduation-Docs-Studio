import { useMemo } from "react"
import { Grid3X3Icon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { LatexSourceCard } from "@/components/workbench/latex-source-card"
import { ToolDraftActions } from "@/components/workbench/tool-draft-actions"
import {
  generateGeneralTableLatex,
  requiredPackagesForGeneralTable,
  type GeneralTableMode,
  type TableColumnAlignment,
} from "@/lib/general-table"
import { parseTableText } from "@/lib/three-line-table"
import { useLocalDraft } from "@/lib/use-local-draft"

const exampleData = "实验条件\t样品 A\t样品 B\n温度（℃）\t25\t50\n转化率（%）\t86.2\t92.7"

const alignmentLabels: Record<TableColumnAlignment, string> = {
  left: "左对齐",
  center: "居中",
  right: "右对齐",
}

const modeLabels: Record<GeneralTableMode, string> = {
  natural: "普通表格",
  page_width: "通栏等宽表格",
  long_table: "跨页表格",
}

type GeneralTableDraft = {
  caption: string
  label: string
  source: string
  headerRows: number
  mode: GeneralTableMode
  alignments: TableColumnAlignment[]
}

const storageKey = "sztu-docs.thesis-tools.general-table.v1"
const initialDraft: GeneralTableDraft = {
  caption: "",
  label: "",
  source: "",
  headerRows: 1,
  mode: "natural",
  alignments: [],
}

function isGeneralTableDraft(value: unknown): value is GeneralTableDraft {
  if (!value || typeof value !== "object") return false
  const draft = value as Record<string, unknown>
  return typeof draft.caption === "string" &&
    typeof draft.label === "string" &&
    typeof draft.source === "string" &&
    typeof draft.headerRows === "number" &&
    Number.isInteger(draft.headerRows) &&
    ["natural", "page_width", "long_table"].includes(String(draft.mode)) &&
    Array.isArray(draft.alignments) &&
    draft.alignments.every((item) => ["left", "center", "right"].includes(String(item)))
}

export function GeneralTableGenerator() {
  const { value: draft, setValue: setDraft, saveState, clearDraft } = useLocalDraft({
    storageKey,
    initialValue: initialDraft,
    isValid: isGeneralTableDraft,
  })
  const { caption, label, source, headerRows, mode, alignments } = draft
  const parsed = useMemo(() => parseTableText(source), [source])
  const columnCount = parsed.rows[0]?.length ?? 0
  const valid = parsed.rows.length > 0 && parsed.errors.length === 0

  const normalizedAlignments = useMemo(
    () => Array.from(
      { length: columnCount },
      (_, index) => alignments[index] ?? (index === 0 ? "left" : "center"),
    ),
    [alignments, columnCount],
  )

  const latex = useMemo(
    () => valid
      ? generateGeneralTableLatex({
          rows: parsed.rows,
          caption,
          label,
          headerRows,
          mode,
          alignments: normalizedAlignments,
        })
      : "",
    [caption, headerRows, label, mode, normalizedAlignments, parsed.rows, valid],
  )

  return (
    <ScrollArea className="h-full">
      <main className="mx-auto grid w-full max-w-6xl gap-6 p-6" aria-labelledby="general-table-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 id="general-table-title" className="text-xl font-semibold">表格生成器</h2>
            <p className="text-sm text-muted-foreground">
              生成普通网格表、通栏表或可跨页表格；适合从 Excel、WPS 直接粘贴数据。
            </p>
          </div>
          <ToolDraftActions saveState={saveState} draftName="表格" onClear={clearDraft} />
        </div>

        <div className="grid items-start gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>表格数据</CardTitle>
              <CardDescription>首行默认作为表头，也可以调整表头行数。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-medium">
                  表题（可选）
                  <Input value={caption} onChange={(event) => setDraft((current) => ({ ...current, caption: event.target.value }))} />
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  引用标签（可选）
                  <Input
                    value={label}
                    onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
                    placeholder="例如：tab:result"
                  />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-medium">
                  表格类型
                  <Select value={mode} onValueChange={(value) => setDraft((current) => ({ ...current, mode: value as GeneralTableMode }))}>
                    <SelectTrigger aria-label="表格类型"><span>{modeLabels[mode]}</span></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="natural">普通表格</SelectItem>
                      <SelectItem value="page_width">通栏等宽表格</SelectItem>
                      <SelectItem value="long_table">跨页表格</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  表头行数
                  <Select value={String(headerRows)} onValueChange={(value) => setDraft((current) => ({ ...current, headerRows: Number(value) }))}>
                    <SelectTrigger aria-label="表头行数">
                      <span>{headerRows === 0 ? "无表头" : `${headerRows} 行`}</span>
                    </SelectTrigger>
                    <SelectContent>
                      {[0, 1, 2, 3].map((count) => (
                        <SelectItem key={count} value={String(count)}>{count === 0 ? "无表头" : `${count} 行`}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              </div>
              <label className="grid gap-2 text-sm font-medium">
                数据
                <Textarea
                  value={source}
                  onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value }))}
                  placeholder={exampleData}
                  className="min-h-56 resize-y"
                  aria-invalid={parsed.errors.length > 0 || undefined}
                />
              </label>
              <Button type="button" variant="outline" className="w-fit" onClick={() => setDraft((current) => ({ ...current, source: exampleData }))}>
                <Grid3X3Icon />
                填入示例
              </Button>
              {valid ? (
                <fieldset className="grid gap-2">
                  <legend className="text-sm font-medium">各列对齐</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {parsed.rows[0].map((heading, index) => (
                      <label key={index} className="flex items-center gap-2 text-sm">
                        <span className="min-w-0 flex-1 truncate" title={heading || `第 ${index + 1} 列`}>
                          {heading || `第 ${index + 1} 列`}
                        </span>
                        <Select
                          value={normalizedAlignments[index]}
                          onValueChange={(value) => setDraft((current) => {
                            const next = [...current.alignments]
                            next[index] = value as TableColumnAlignment
                            return { ...current, alignments: next }
                          })}
                        >
                          <SelectTrigger aria-label={`${heading || `第 ${index + 1} 列`}对齐方式`} className="w-28">
                            <span>{alignmentLabels[normalizedAlignments[index]]}</span>
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(alignmentLabels) as TableColumnAlignment[]).map((item) => (
                              <SelectItem key={item} value={item}>{alignmentLabels[item]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}
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
              <CardDescription>预览反映边框和对齐关系，最终字号由论文模板决定。</CardDescription>
            </CardHeader>
            <CardContent>
              {valid ? (
                <div className="overflow-x-auto rounded-lg border p-4">
                  {caption.trim() ? <p className="mb-3 text-center text-sm font-medium">{caption.trim()}</p> : null}
                  <Table aria-label="普通表格预览" className="border-collapse border">
                    <TableHeader>
                      {parsed.rows.slice(0, headerRows).map((row, rowIndex) => (
                        <TableRow key={rowIndex}>
                          {row.map((cell, cellIndex) => (
                            <TableHead
                              key={cellIndex}
                              className="border whitespace-normal"
                              style={{ textAlign: normalizedAlignments[cellIndex] }}
                            >
                              {cell}
                            </TableHead>
                          ))}
                        </TableRow>
                      ))}
                    </TableHeader>
                    <TableBody>
                      {parsed.rows.slice(headerRows).map((row, rowIndex) => (
                        <TableRow key={rowIndex} className="hover:bg-transparent">
                          {row.map((cell, cellIndex) => (
                            <TableCell
                              key={cellIndex}
                              className="border whitespace-normal"
                              style={{ textAlign: normalizedAlignments[cellIndex] }}
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
                <div className="flex min-h-56 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  粘贴至少两列数据后在这里预览。
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <LatexSourceCard
          latex={latex}
          filename="table.tex"
          packages={requiredPackagesForGeneralTable(mode)}
        />
      </main>
    </ScrollArea>
  )
}
