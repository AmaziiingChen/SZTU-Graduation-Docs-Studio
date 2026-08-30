import { useMemo } from "react"
import { BookOpenCheckIcon, BracesIcon, TriangleAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { formatBibtex, parseBibtex } from "@/lib/bibtex"
import type {
  ParagraphInput,
  RichParagraph,
  StructuredRun,
} from "@/types/structured-content"

export type ReferenceImporterProps = {
  label?: string
  source: string
  legacyReferences?: readonly ParagraphInput[]
  maximumEntries: number
  maximumReferenceLength: number
  disabled?: boolean
  onChange: (source: string) => void
}

function ReferenceRun({ run }: { run: StructuredRun }) {
  let content = <>{run.text}</>
  if (run.script === "sub") content = <sub>{content}</sub>
  if (run.script === "super") content = <sup>{content}</sup>
  if (run.italic) content = <em>{content}</em>
  if (run.bold) content = <strong>{content}</strong>
  return <>{content}</>
}

function FormattedReferencePreview({ paragraph }: { paragraph: RichParagraph }) {
  return (
    <p className="text-sm leading-6">
      {paragraph.runs.map((run, index) => (
        <ReferenceRun
          key={`${index}-${run.text}-${run.script ?? "normal"}`}
          run={run}
        />
      ))}
    </p>
  )
}

function richParagraph(value: ParagraphInput): RichParagraph {
  return typeof value === "string"
    ? { type: "paragraph", runs: [{ text: value }] }
    : value
}

function separateBibtexEntries(source: string): string {
  const entries = parseBibtex(source).entries
  if (entries.length < 2) return source

  let cursor = 0
  let separated = ""
  for (const [index, entry] of entries.entries()) {
    const start = source.indexOf(entry.raw, cursor)
    if (start < 0) return source
    const between = source.slice(cursor, start)
    separated += index > 0 && between.trim() === "" ? "\n\n" : between
    separated += entry.raw
    cursor = start + entry.raw.length
  }
  return separated + source.slice(cursor)
}

export function ReferenceImporter({
  label = "参考文献",
  source,
  legacyReferences = [],
  maximumEntries,
  maximumReferenceLength,
  disabled = false,
  onChange,
}: ReferenceImporterProps) {
  const result = useMemo(() => formatBibtex(source), [source])
  const sourcePresent = source.trim().length > 0
  const lengthIssues = result.references.flatMap((reference) =>
    reference.text.length > maximumReferenceLength
      ? [`${reference.citationKey} 生成后超过 ${maximumReferenceLength} 个字符。`]
      : [],
  )
  const countIssue =
    result.references.length > maximumEntries
      ? `参考文献最多支持 ${maximumEntries} 条。`
      : null
  const valid =
    sourcePresent &&
    result.entries.length > 0 &&
    result.issues.length === 0 &&
    lengthIssues.length === 0 &&
    countIssue === null
  const previewReferences = result.references.filter(
    (reference) =>
      !result.issues.some(
        (issue) => issue.citationKey === reference.citationKey,
      ),
  )
  const preview = sourcePresent && previewReferences.length > 0
    ? previewReferences.map((reference) => ({
        id: reference.id,
        key: reference.citationKey,
        paragraph: reference.paragraph,
      }))
    : legacyReferences.map((paragraph, index) => ({
        id: `legacy-${index}`,
        key: `旧条目 ${index + 1}`,
        paragraph: richParagraph(paragraph),
      }))

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="grid gap-1">
            <label className="text-sm font-medium" htmlFor="bibliography-source">
              {label} BibTeX
            </label>
            <p className="text-xs text-muted-foreground">
              从知网、期刊网站或文献管理软件复制完整 BibTeX；系统会在本机解析并按粘贴顺序生成引用。
            </p>
          </div>
          <Badge variant="outline">
            <BracesIcon />
            本地自动解析
          </Badge>
        </div>
        <Textarea
          id="bibliography-source"
          aria-label={`${label} BibTeX`}
          value={source}
          disabled={disabled}
          className="min-h-64 resize-y"
          placeholder={'@article{key,\n  author = {作者},\n  title = {题名},\n  journal = {期刊},\n  year = {2026}\n}'}
          spellCheck={false}
          onChange={(event) => onChange(separateBibtexEntries(event.target.value))}
        />
      </div>

      {sourcePresent && !valid ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>BibTeX 尚未通过检查</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-5">
              {result.issues.map((item, index) => (
                <li key={`${item.code}-${item.offset}-${index}`}>{item.message}</li>
              ))}
              {countIssue ? <li>{countIssue}</li> : null}
              {lengthIssues.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
            {legacyReferences.length > 0 ? (
              <p className="mt-2">当前仍保留上一次有效的格式化条目，不会被错误输入覆盖。</p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {!sourcePresent && legacyReferences.length > 0 ? (
        <Alert>
          <BookOpenCheckIcon />
          <AlertTitle>已保留旧版参考文献</AlertTitle>
          <AlertDescription>
            这些条目来自现有文档，仍可继续导出。粘贴 BibTeX 后，系统会用自动排版结果替换它们。
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">自动排版结果</p>
          <Badge variant={valid || (!sourcePresent && preview.length > 0) ? "secondary" : "outline"}>
            {preview.length} 条
          </Badge>
        </div>
        {preview.length > 0 ? (
          <ScrollArea className="max-h-80 rounded-lg border">
            <div className="divide-y">
              {preview.map((reference) => (
                <div className="grid gap-1 p-3" key={reference.id}>
                  <Badge variant="outline" className="w-fit">
                    {reference.key}
                  </Badge>
                  <FormattedReferencePreview paragraph={reference.paragraph} />
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            粘贴有效 BibTeX 后，这里会显示最终进入 Word、PDF 和 LaTeX 的参考文献。
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          最终条目按 GB/T 7714 数字顺序制的常见类型规则生成；BibTeX 原文只保存在本机草稿中，不会写入导出文件。
        </p>
      </div>
    </div>
  )
}
