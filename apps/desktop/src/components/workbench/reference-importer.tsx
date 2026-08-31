import { useMemo, useState } from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BookOpenCheckIcon,
  BracesIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { formatBibtex, parseBibtex } from "@/lib/bibtex"
import type { BibtexEntry, FormattedBibtexResult } from "@/types/references"
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

type EntryEditorState =
  | { mode: "add"; source: string }
  | { mode: "edit"; index: number; source: string }

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

function joinEntries(entries: readonly string[]): string {
  return entries.map((entry) => entry.trim()).filter(Boolean).join("\n\n")
}

function appendSource(current: string, addition: string): string {
  const normalizedAddition = separateBibtexEntries(addition.trim())
  if (!current.trim()) return normalizedAddition
  if (!normalizedAddition) return current
  return `${current.trimEnd()}\n\n${normalizedAddition}`
}

function sourceRemainder(source: string, entries: readonly BibtexEntry[]): string {
  let cursor = 0
  let remainder = ""
  for (const entry of entries) {
    const start = source.indexOf(entry.raw, cursor)
    if (start < 0) return source
    remainder += source.slice(cursor, start)
    cursor = start + entry.raw.length
  }
  return remainder + source.slice(cursor)
}

function validationMessages(
  result: FormattedBibtexResult,
  maximumEntries: number,
  maximumReferenceLength: number,
): string[] {
  return [
    ...result.issues.map((issue) => issue.message),
    ...(result.entries.length === 0 ? ["没有识别到可用的 BibTeX 条目。"] : []),
    ...(result.entries.length > maximumEntries
      ? [`参考文献最多支持 ${maximumEntries} 条。`]
      : []),
    ...result.references.flatMap((reference) =>
      reference.text.length > maximumReferenceLength
        ? [`${reference.citationKey} 生成后超过 ${maximumReferenceLength} 个字符。`]
        : [],
    ),
  ]
}

const EMPTY_ENTRY =
  "@article{key,\n  author = {作者},\n  title = {题名},\n  journal = {期刊},\n  year = {2026}\n}"

export function ReferenceImporter({
  label = "参考文献",
  source,
  legacyReferences = [],
  maximumEntries,
  maximumReferenceLength,
  disabled = false,
  onChange,
}: ReferenceImporterProps) {
  const [entryEditor, setEntryEditor] = useState<EntryEditorState | null>(null)
  const [batchSource, setBatchSource] = useState<string | null>(null)
  const [advancedSource, setAdvancedSource] = useState<string | null>(null)
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null)

  const result = useMemo(() => formatBibtex(source), [source])
  const sourcePresent = source.trim().length > 0
  const currentMessages = validationMessages(
    result,
    maximumEntries,
    maximumReferenceLength,
  )
  const sourceIsAdvanced =
    sourcePresent && sourceRemainder(source, result.entries).trim().length > 0
  const valid = sourcePresent && currentMessages.length === 0
  const editableEntries = result.entries.map((entry, index) => ({
    ...entry,
    index,
    paragraph: result.references[index]?.paragraph,
  }))

  const entryCandidateSource = entryEditor?.source ?? ""
  const entryCandidate = useMemo(
    () => formatBibtex(entryCandidateSource),
    [entryCandidateSource],
  )
  const entryMessages = entryEditor && entryCandidateSource.trim()
    ? [
        ...validationMessages(
          entryCandidate,
          1,
          maximumReferenceLength,
        ),
        ...(entryCandidate.entries.length > 1
          ? ["每次只能编辑一条参考文献。"]
          : []),
        ...(sourceRemainder(entryCandidateSource, entryCandidate.entries).trim()
          ? ["单条编辑器只接受一个完整条目；宏、注释等内容请使用高级源码模式。"]
          : []),
      ]
    : []

  const nextEntrySource = (() => {
    if (!entryEditor || entryMessages.length > 0) return null
    const raw = entryCandidate.entries[0]?.raw
    if (!raw) return null
    if (entryEditor.mode === "add") return appendSource(source, raw)
    const entries = result.entries.map((entry) => entry.raw)
    entries[entryEditor.index] = raw
    return joinEntries(entries)
  })()
  const nextEntryMessages = nextEntrySource
    ? validationMessages(
        formatBibtex(nextEntrySource),
        maximumEntries,
        maximumReferenceLength,
      )
    : []

  const combinedBatchSource = batchSource === null
    ? null
    : appendSource(source, batchSource)
  const batchMessages = combinedBatchSource === null
    ? []
    : validationMessages(
        formatBibtex(combinedBatchSource),
        maximumEntries,
        maximumReferenceLength,
      )

  const openAdd = () => setEntryEditor({ mode: "add", source: "" })
  const openEdit = (index: number) => {
    const entry = result.entries[index]
    if (!entry || sourceIsAdvanced) return
    setEntryEditor({ mode: "edit", index, source: entry.raw })
  }
  const moveEntry = (index: number, direction: -1 | 1) => {
    if (sourceIsAdvanced) return
    const target = index + direction
    if (target < 0 || target >= result.entries.length) return
    const entries = result.entries.map((entry) => entry.raw)
    ;[entries[index], entries[target]] = [entries[target], entries[index]]
    onChange(joinEntries(entries))
  }
  const removeEntry = () => {
    if (deleteIndex === null || sourceIsAdvanced) return
    onChange(
      joinEntries(
        result.entries
          .filter((_, index) => index !== deleteIndex)
          .map((entry) => entry.raw),
      ),
    )
    setDeleteIndex(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={valid || (!sourcePresent && legacyReferences.length > 0) ? "secondary" : "outline"}>
            {result.entries.length || legacyReferences.length} 条
          </Badge>
          {sourceIsAdvanced ? <Badge variant="outline">高级源码</Badge> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={openAdd} disabled={disabled}>
            <PlusIcon />
            添加参考文献
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setBatchSource("")}
            disabled={disabled}
          >
            批量粘贴 BibTeX
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setAdvancedSource(source)}
            disabled={disabled}
          >
            <BracesIcon />
            高级源码
          </Button>
        </div>
      </div>

      {sourcePresent && currentMessages.length > 0 ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>BibTeX 尚未通过检查</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-5">
              {currentMessages.map((message, index) => (
                <li key={`${message}-${index}`}>{message}</li>
              ))}
            </ul>
            {legacyReferences.length > 0 ? (
              <p className="mt-2">当前仍保留上一次有效的格式化条目，不会被错误输入覆盖。</p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {sourceIsAdvanced ? (
        <Alert>
          <BracesIcon />
          <AlertTitle>当前文献包含宏、注释或其他高级源码</AlertTitle>
          <AlertDescription>
            为避免破坏 BibTeX 依赖，条目编辑、删除和调整顺序已关闭；请在“高级源码”中修改。仍可继续添加独立条目或批量导入。
          </AlertDescription>
        </Alert>
      ) : null}

      {!sourcePresent && legacyReferences.length > 0 ? (
        <Alert>
          <BookOpenCheckIcon />
          <AlertTitle>已保留旧版参考文献</AlertTitle>
          <AlertDescription>
            这些条目来自现有文档，仍可继续导出。添加 BibTeX 后，系统会用自动排版结果替换它们。
          </AlertDescription>
        </Alert>
      ) : null}

      {editableEntries.length > 0 ? (
        <ScrollArea className="min-h-0 flex-1 rounded-lg border">
          <Accordion className="px-3">
            {editableEntries.map((reference) => (
              <AccordionItem key={reference.id} value={reference.id}>
                <AccordionTrigger className="font-normal hover:no-underline">
                  <span className="min-w-0 pr-2">
                    {reference.paragraph ? (
                      <FormattedReferencePreview paragraph={reference.paragraph} />
                    ) : (
                      <span className="text-muted-foreground">{reference.citationKey}</span>
                    )}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="grid gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{reference.citationKey}</Badge>
                    <Badge variant="outline">{reference.type}</Badge>
                    <div className="ml-auto flex items-center gap-1">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        aria-label={`上移 ${reference.citationKey}`}
                        disabled={disabled || sourceIsAdvanced || reference.index === 0}
                        onClick={() => moveEntry(reference.index, -1)}
                      >
                        <ArrowUpIcon />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        aria-label={`下移 ${reference.citationKey}`}
                        disabled={
                          disabled ||
                          sourceIsAdvanced ||
                          reference.index === editableEntries.length - 1
                        }
                        onClick={() => moveEntry(reference.index, 1)}
                      >
                        <ArrowDownIcon />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        aria-label={`编辑 ${reference.citationKey}`}
                        disabled={disabled || sourceIsAdvanced}
                        onClick={() => openEdit(reference.index)}
                      >
                        <PencilIcon />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        aria-label={`删除 ${reference.citationKey}`}
                        disabled={disabled || sourceIsAdvanced}
                        onClick={() => setDeleteIndex(reference.index)}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  </div>
                  <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
                    {reference.raw}
                  </pre>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          <div className="flex justify-center border-t p-3">
            <Button type="button" variant="outline" size="sm" onClick={openAdd} disabled={disabled}>
              <PlusIcon />
              继续添加
            </Button>
          </div>
        </ScrollArea>
      ) : legacyReferences.length > 0 ? (
        <ScrollArea className="min-h-0 flex-1 rounded-lg border">
          <div className="divide-y">
            {legacyReferences.map((paragraph, index) => (
              <div className="flex items-start gap-3 p-3" key={`legacy-${index}`}>
                <Badge variant="outline">[{index + 1}]</Badge>
                <FormattedReferencePreview paragraph={richParagraph(paragraph)} />
              </div>
            ))}
          </div>
        </ScrollArea>
      ) : (
        <div className="grid min-h-64 flex-1 place-items-center rounded-lg border border-dashed p-6 text-center">
          <div className="grid max-w-sm justify-items-center gap-3">
            <BookOpenCheckIcon className="size-8 text-muted-foreground" />
            <div className="grid gap-1">
              <p className="text-sm font-medium">还没有参考文献</p>
              <p className="text-sm text-muted-foreground">
                逐条添加便于检查和排序；已有多条 BibTeX 时可直接批量粘贴。
              </p>
            </div>
            <Button type="button" onClick={openAdd} disabled={disabled}>
              <PlusIcon />
              添加第一条参考文献
            </Button>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        条目按列表顺序进入 Word、PDF 和 LaTeX；调整顺序不会自动修改正文中手动输入的引用编号。
      </p>

      <Dialog
        open={entryEditor !== null}
        onOpenChange={(open) => !open && setEntryEditor(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {entryEditor?.mode === "edit" ? "编辑参考文献" : "添加参考文献"}
            </DialogTitle>
            <DialogDescription>
              输入一个完整 BibTeX 条目，完成后自动生成引用格式。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="单条参考文献 BibTeX"
            className="min-h-64 resize-y font-mono text-xs"
            value={entryCandidateSource}
            spellCheck={false}
            placeholder={EMPTY_ENTRY}
            onChange={(event) =>
              setEntryEditor((current) =>
                current ? { ...current, source: event.target.value } : current,
              )
            }
          />
          {[...entryMessages, ...nextEntryMessages].length > 0 ? (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>这条 BibTeX 还不能保存</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-5">
                  {[...entryMessages, ...nextEntryMessages].map((message, index) => (
                    <li key={`${message}-${index}`}>{message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEntryEditor(null)}>
              取消
            </Button>
            <Button
              type="button"
              disabled={!nextEntrySource || nextEntryMessages.length > 0}
              onClick={() => {
                if (!nextEntrySource) return
                onChange(nextEntrySource)
                setEntryEditor(null)
              }}
            >
              完成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={batchSource !== null} onOpenChange={(open) => !open && setBatchSource(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>批量粘贴 BibTeX</DialogTitle>
            <DialogDescription>
              可一次粘贴多条内容；通过检查后会追加到现有参考文献末尾。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="批量参考文献 BibTeX"
            className="min-h-72 resize-y font-mono text-xs"
            value={batchSource ?? ""}
            spellCheck={false}
            placeholder={EMPTY_ENTRY}
            onChange={(event) => setBatchSource(event.target.value)}
          />
          {batchSource !== null && batchSource.trim() && batchMessages.length > 0 ? (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>批量内容尚未通过检查</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-5">
                  {batchMessages.map((message, index) => (
                    <li key={`${message}-${index}`}>{message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBatchSource(null)}>
              取消
            </Button>
            <Button
              type="button"
              disabled={!batchSource?.trim() || batchMessages.length > 0}
              onClick={() => {
                if (!combinedBatchSource) return
                onChange(separateBibtexEntries(combinedBatchSource))
                setBatchSource(null)
              }}
            >
              添加这些条目
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={advancedSource !== null}
        onOpenChange={(open) => !open && setAdvancedSource(null)}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>高级 BibTeX 源码</DialogTitle>
            <DialogDescription>
              用于批量校对以及编辑 @string、注释、宏或其他复杂内容。源码即使暂未通过检查也可保存为草稿。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label={`${label}高级 BibTeX 源码`}
            className="min-h-96 resize-y font-mono text-xs"
            value={advancedSource ?? ""}
            spellCheck={false}
            placeholder={EMPTY_ENTRY}
            onChange={(event) => setAdvancedSource(event.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAdvancedSource(null)}>
              取消
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (advancedSource === null) return
                onChange(separateBibtexEntries(advancedSource))
                setAdvancedSource(null)
              }}
            >
              保存源码
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteIndex !== null} onOpenChange={(open) => !open && setDeleteIndex(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除这条参考文献？</DialogTitle>
            <DialogDescription>
              删除后后续条目会自动前移；正文中手动输入的引用编号不会同步修改。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteIndex(null)}>
              取消
            </Button>
            <Button type="button" variant="destructive" onClick={removeEntry}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
