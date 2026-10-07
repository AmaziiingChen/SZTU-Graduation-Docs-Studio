import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { FeatherIcon } from "@/components/ui/feather"
import { ArrowUpIcon } from "@/components/ui/arrow-up"
import { ArrowDownIcon } from "@/components/ui/arrow-down"
import { PlusIcon } from "@/components/ui/plus"
import { CircleCheckIcon } from "@/components/ui/circle-check"
import { DeleteIcon } from "@/components/ui/delete"
import { AnimatedActionIcon } from "@/components/animated-action-icon"
import { useMemo, useState, type ReactNode } from "react"
import { BookOpenCheckIcon, TriangleAlertIcon } from "lucide-react"

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
import { Textarea } from "@/components/ui/textarea"
import { ContentStatistics } from "@/components/workbench/content-statistics"
import { FadingScrollArea } from "@/components/workbench/fading-scroll-area"
import { formatBibtex, formatBibtexEntry, parseBibtex } from "@/lib/bibtex"
import type { BibtexEntry, FormattedBibtexResult } from "@/types/references"
import type {
  ParagraphInput,
  RichParagraph,
  StructuredRun,
} from "@/types/structured-content"

export type ReferenceImporterProps = {
  source: string
  referenceOrder?: readonly string[]
  legacyReferences?: readonly ParagraphInput[]
  maximumEntries: number
  maximumReferenceLength: number
  disabled?: boolean
  onChange: (source: string) => void
  footerStatus?: ReactNode
}

type EntryEditorState =
  | { mode: "add"; source: string }
  | { mode: "edit"; index: number; source: string }

export function ReferenceRun({ run }: { run: StructuredRun }) {
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
      {paragraph.runs.filter((run) => "text" in run).map((run, index) => (
        <ReferenceRun
          key={`${index}-${"text" in run ? run.text : ""}-${"script" in run ? run.script ?? "normal" : "normal"}`}
          run={run as StructuredRun}
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
  source,
  referenceOrder,
  legacyReferences = [],
  maximumEntries,
  maximumReferenceLength,
  disabled = false,
  onChange,
  footerStatus,
}: ReferenceImporterProps) {
  const [entryEditor, setEntryEditor] = useState<EntryEditorState | null>(null)
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
  const editableEntries = result.entries.map((entry, index) => {
    const number = referenceOrder?.indexOf(entry.citationKey)
    const paragraph = number === undefined ? result.references[index]?.paragraph : formatBibtexEntry(entry, number).paragraph
    if (number === -1 && paragraph?.runs[0] && "text" in paragraph.runs[0]) paragraph.runs[0].text = paragraph.runs[0].text.replace(/^\[0\]/, "[未引用]")
    return { ...entry, index, paragraph, position: number === undefined ? index : number < 0 ? Number.MAX_SAFE_INTEGER : number }
  }).sort((a, b) => a.position - b.position)

  const entryCandidateSource = entryEditor?.source ?? ""
  const entryCandidate = useMemo(
    () => formatBibtex(entryCandidateSource),
    [entryCandidateSource],
  )
  const entryMessages = entryEditor && entryCandidateSource.trim()
    ? [
        ...validationMessages(
          entryCandidate,
          entryEditor.mode === "add" ? maximumEntries : 1,
          maximumReferenceLength,
        ),
        ...(entryEditor.mode === "edit" && entryCandidate.entries.length > 1
          ? ["编辑时只能保留一条参考文献。"]
          : []),
        ...(sourceRemainder(entryCandidateSource, entryCandidate.entries).trim()
          ? ["仅支持完整的 BibTeX 条目，暂不支持宏、注释或其他扩展源码。"]
          : []),
      ]
    : []

  const nextEntrySource = (() => {
    if (!entryEditor || entryMessages.length > 0) return null
    const entriesToSave = entryCandidate.entries.map((entry) => entry.raw)
    if (entriesToSave.length === 0) return null
    if (entryEditor.mode === "add") {
      return appendSource(source, joinEntries(entriesToSave))
    }
    const entries = result.entries.map((entry) => entry.raw)
    entries[entryEditor.index] = entriesToSave[0]
    return joinEntries(entries)
  })()
  const nextEntryMessages = nextEntrySource
    ? validationMessages(
        formatBibtex(nextEntrySource),
        maximumEntries,
        maximumReferenceLength,
      )
    : []

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
    <div className="flex h-full min-h-0 flex-col">
      <div
        data-slot="reference-content"
        className="flex min-h-0 flex-1 flex-col gap-4 pt-4"
      >
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
              <p className="mt-2">已保留上次保存的参考文献。</p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {sourceIsAdvanced ? (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>当前文献包含宏、注释或其他扩展内容</AlertTitle>
          <AlertDescription>
            为保留 BibTeX 依赖，现有条目暂不支持单独编辑、删除或排序，仍可添加新文献。
          </AlertDescription>
        </Alert>
      ) : null}

      {!sourcePresent && legacyReferences.length > 0 ? (
        <Alert>
          <BookOpenCheckIcon />
          <AlertTitle>已保留旧版参考文献</AlertTitle>
          <AlertDescription>
            旧版参考文献仍可导出，导入 BibTeX 后将被替换。
          </AlertDescription>
        </Alert>
      ) : null}

      {editableEntries.length > 0 ? (
        <FadingScrollArea
          wrapperClassName="min-h-0 flex-1"
          className="h-full min-h-0 flex-1"
        >
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
                        disabled={referenceOrder !== undefined || disabled || sourceIsAdvanced || reference.index === 0}
                        onClick={() => moveEntry(reference.index, -1)}
                      >
                        <AnimatedActionIcon icon={ArrowUpIcon} />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        aria-label={`下移 ${reference.citationKey}`}
                        disabled={
                          disabled ||
                          sourceIsAdvanced ||
                          referenceOrder !== undefined || reference.index === editableEntries.length - 1
                        }
                        onClick={() => moveEntry(reference.index, 1)}
                      >
                        <AnimatedActionIcon icon={ArrowDownIcon} />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        aria-label={`编辑 ${reference.citationKey}`}
                        disabled={disabled || sourceIsAdvanced}
                        onClick={() => openEdit(reference.index)}
                      >
                        <AnimatedActionIcon icon={FeatherIcon} />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        aria-label={`删除 ${reference.citationKey}`}
                        disabled={disabled || sourceIsAdvanced}
                        onClick={() => setDeleteIndex(reference.index)}
                      >
                        <AnimatedActionIcon icon={DeleteIcon} />
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
              <AnimatedActionIcon icon={PlusIcon} />
              继续添加
            </Button>
          </div>
        </FadingScrollArea>
      ) : legacyReferences.length > 0 ? (
        <FadingScrollArea
          wrapperClassName="min-h-0 flex-1"
          className="h-full min-h-0 flex-1"
        >
          <div className="divide-y">
            {legacyReferences.map((paragraph, index) => (
              <div className="flex items-start gap-3 p-3" key={`legacy-${index}`}>
                <Badge variant="outline">[{index + 1}]</Badge>
                <FormattedReferencePreview paragraph={richParagraph(paragraph)} />
              </div>
            ))}
          </div>
          <div className="flex justify-center border-t p-3">
            <Button type="button" variant="outline" size="sm" onClick={openAdd} disabled={disabled}>
              <AnimatedActionIcon icon={PlusIcon} />
              继续添加
            </Button>
          </div>
        </FadingScrollArea>
      ) : (
        <Empty data-slot="reference-empty-state" className="min-h-64">
          <EmptyHeader>
            <EmptyMedia variant="icon"><BookOpenCheckIcon aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>还没有参考文献</EmptyTitle>
            <EmptyDescription>粘贴 BibTeX 条目后，引用格式会自动生成。</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button type="button" onClick={openAdd} disabled={disabled}>
              <AnimatedActionIcon icon={PlusIcon} />
              添加第一条参考文献
            </Button>
          </EmptyContent>
        </Empty>
      )}
      </div>

      <div data-slot="reference-status-footer" className="flex min-h-8 shrink-0 items-center justify-end gap-3 px-3 py-1">
        <ContentStatistics
          summary={`文献 ${result.entries.length || legacyReferences.length} 条`}
          details={[
            { label: "文献条目", value: result.entries.length || legacyReferences.length },
            { label: "BibTeX 条目", value: result.entries.length },
            { label: "文献类型", value: new Set(result.entries.map((entry) => entry.type)).size },
            { label: "待处理问题", value: currentMessages.length },
          ]}
        />
        {footerStatus}
      </div>

      <Dialog
        open={entryEditor !== null}
        onOpenChange={(open) => !open && setEntryEditor(null)}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {entryEditor?.mode === "edit" ? "编辑参考文献" : "添加参考文献"}
            </DialogTitle>
            <DialogDescription>
              {entryEditor?.mode === "edit"
                ? "修改 BibTeX 条目后保存。"
                : "粘贴一条或多条 BibTeX 条目。"}
            </DialogDescription>
          </DialogHeader>
          <div
            data-slot="reference-entry-dialog-body"
            // Reserve space inside the scroll clip for the Textarea's 3px focus ring.
            className="-m-1 grid min-h-0 gap-4 overflow-y-auto p-1"
          >
            <Textarea
              aria-label={
                entryEditor?.mode === "edit"
                  ? "单条参考文献 BibTeX"
                  : "参考文献 BibTeX"
              }
              className="field-sizing-fixed h-72 min-h-48 resize-none overflow-y-auto font-mono text-xs"
              value={entryCandidateSource}
              spellCheck={false}
              placeholder={EMPTY_ENTRY}
              onChange={(event) =>
                setEntryEditor((current) =>
                  current ? { ...current, source: event.target.value } : current,
                )
              }
            />
            {entryEditor?.mode === "add" ? (
              <Accordion>
                <AccordionItem value="bibtex-help">
                  <AccordionTrigger className="font-normal">如何获取 BibTeX</AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <p>在文献管理器或论文数据库中找到“导出”或“引用”，选择 BibTeX 格式，再把条目复制到上方。</p>
                    <p>条目通常以 @article 或 @book 开头；普通参考文献文字目前不能直接添加。</p>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            ) : null}
            {[...entryMessages, ...nextEntryMessages].length > 0 ? (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertTitle>BibTeX 还不能保存</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc space-y-1 pl-5">
                    {[...entryMessages, ...nextEntryMessages].map((message, index) => (
                      <li key={`${message}-${index}`}>{message}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
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
              <AnimatedActionIcon icon={entryEditor?.mode === "add" ? PlusIcon : CircleCheckIcon} />
              {entryEditor?.mode === "add"
                ? `添加 ${entryCandidate.entries.length} 条参考文献`
                : "完成"}
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
              <AnimatedActionIcon icon={DeleteIcon} />
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
