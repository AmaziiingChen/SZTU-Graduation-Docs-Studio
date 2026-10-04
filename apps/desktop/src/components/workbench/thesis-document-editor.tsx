import { Field, FieldLabel } from "@/components/ui/field"
import { useId } from "react"
import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DocumentDateField, parseDocumentDate } from "@/components/workbench/document-date-field"
import { ReferenceImporter } from "@/components/workbench/reference-importer"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { StructuredContentEditor } from "@/components/workbench/structured-content-editor"
import { AnimatedActionIcon } from "@/components/animated-action-icon"
import { PlusIcon } from "@/components/ui/plus"
import { DeleteIcon } from "@/components/ui/delete"
import { ArrowUpIcon } from "@/components/ui/arrow-up"
import { ArrowDownIcon } from "@/components/ui/arrow-down"
import { Badge } from "@/components/ui/badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { thesisReferences, normalizeThesisFigures, thesisFigureContext, chapterEnd, chapterNumbers, moveChapter, siblingIndex, type ThesisDraft } from "@/lib/thesis-draft"

export function ThesisDocumentEditor({ value, onChange, activeSection, disabled = false }: {
  value: ThesisDraft; onChange: (value: ThesisDraft) => void; activeSection: string; disabled?: boolean
}) {
  const componentFieldId = useId()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const index = Math.max(0, value.chapters.findIndex(c => c.id === selectedId))
  const chapter = value.chapters[index]
  const numbers = chapterNumbers(value.chapters)
  const figures = thesisFigureContext(value, index)
  const references = thesisReferences(value)
  figures.numbering.knownLabels = { ...figures.numbering.knownLabels, ...references.labels }
  const update = (patch: Partial<ThesisDraft>) => onChange(normalizeThesisFigures({ ...value, ...patch }))
  const add = (parent = -1) => {
    const node = { id: crypto.randomUUID(), level: parent < 0 ? 1 : value.chapters[parent].level + 1, title: "", body: [] }
    const at = parent < 0 ? value.chapters.length : chapterEnd(value.chapters, parent)
    update({ chapters: [...value.chapters.slice(0, at), node, ...value.chapters.slice(at)] })
    setSelectedId(node.id)
  }
  const body = (field: "abstractCn" | "abstractEn" | "acknowledgements" | "appendix", label: string, footer?: ReactNode) => (
    <StructuredContentEditor key={field} value={value[field]} onChange={v => update({ [field]: v })} ariaLabel={label} disabled={disabled} enableFigures={false} placeholder={`开始填写${label}`} fillHeight className="min-h-0 flex-1" contentFooter={footer} />
  )
  const writingSection = ["thesis_abstract_cn", "thesis_abstract_en", "thesis_chapters", "thesis_references", "thesis_acknowledgements", "thesis_appendix"].includes(activeSection)
  return <>
    {writingSection ? <div className="flex h-full min-h-0 flex-col">
      {activeSection === "thesis_abstract_cn" && body("abstractCn", "摘要",
        <Field orientation="horizontal" className="shrink-0 border-t px-3 py-2">
                  <FieldLabel htmlFor={`${componentFieldId}-1`}>关键词</FieldLabel>
                  <Input id={`${componentFieldId}-1`} className="min-w-0 flex-1" value={value.keywordsCn} disabled={disabled} placeholder="使用分号分隔关键词" onChange={e => update({ keywordsCn: e.target.value })} />
                </Field>)}
      {activeSection === "thesis_abstract_en" && body("abstractEn", "Abstract",
        <Field orientation="horizontal" className="shrink-0 border-t px-3 py-2">
                  <FieldLabel htmlFor={`${componentFieldId}-2`}>Key words</FieldLabel>
                  <Input id={`${componentFieldId}-2`} className="min-w-0 flex-1" value={value.keywordsEn} disabled={disabled} placeholder="使用分号分隔关键词" onChange={e => update({ keywordsEn: e.target.value })} />
                </Field>)}
      {activeSection === "thesis_chapters" && (value.chapters.length === 0 ? <div className="flex h-full flex-col">
        <div className="flex h-(--header-height) shrink-0 items-center justify-between border-b px-3"><h2 className="sr-only">章节正文</h2><Button variant="outline" disabled={disabled} onClick={() => add()}><AnimatedActionIcon icon={PlusIcon} />添加章</Button></div>
      </div> : <StructuredContentEditor
        key={`${chapter.id}-${figures.chapters[0].value}`}
        value={chapter.body}
        disabled={disabled}
        enableFigures
        enableDocumentTools
        figureChapters={figures.chapters}
        figureCatalog={figures.catalog}
        figureNumbering={figures.numbering}
        thesisReferences={references.options}
        ariaLabel="章节正文"
        placeholder="开始填写这一章节"
        fillHeight
        className="min-h-0 flex-1"
        onChange={v => update({ chapters: value.chapters.map(c => c.id === chapter.id ? { ...c, body: v } : c) })}
        contentHeader={<div className="shrink-0 border-b px-3 py-2">
          <h2 className="sr-only">章节正文</h2>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Select value={chapter.id} onValueChange={id => setSelectedId(id)}>
              <SelectTrigger aria-label="选择章节" className="shrink-0"><SelectValue>切换章节</SelectValue></SelectTrigger>
              <SelectContent>{value.chapters.map((c, i) => <SelectItem key={c.id} value={c.id}>{numbers[i]} {c.title || "未命名章节"}</SelectItem>)}</SelectContent>
            </Select>
            <span className="shrink-0 text-sm font-medium" aria-hidden="true">{numbers[index]}</span>
            <Input aria-label="章节标题" className="min-w-40 flex-1" value={chapter.title} disabled={disabled} maxLength={200} placeholder="填写章节标题" onChange={e => update({ chapters: value.chapters.map(c => c.id === chapter.id ? { ...c, title: e.target.value } : c) })} />
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" disabled={disabled} />}>章节操作</DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={value.chapters.length >= 200 || value.chapters.filter(c => c.level === 1).length >= 99} onClick={() => add()}><AnimatedActionIcon icon={PlusIcon} />添加章</DropdownMenuItem>
                <DropdownMenuItem disabled={chapter.level >= 3 || value.chapters.length >= 200} onClick={() => add(index)}><AnimatedActionIcon icon={PlusIcon} />添加下级章节</DropdownMenuItem>
                <DropdownMenuItem disabled={siblingIndex(value.chapters, index, -1) < 0} onClick={() => update({ chapters: moveChapter(value.chapters, index, -1) })}><AnimatedActionIcon icon={ArrowUpIcon} />上移</DropdownMenuItem>
                <DropdownMenuItem disabled={siblingIndex(value.chapters, index, 1) < 0} onClick={() => update({ chapters: moveChapter(value.chapters, index, 1) })}><AnimatedActionIcon icon={ArrowDownIcon} />下移</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={() => setDeleteId(chapter.id)}><AnimatedActionIcon icon={DeleteIcon} />删除章节</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {references.missing.length > 0 && <p role="alert" className="mt-2 text-sm text-destructive">引用失效，请恢复目标或在正文中删除对应引用：{references.missing.join("；")}</p>}
        </div>}
      />)}
      {activeSection === "thesis_acknowledgements" && body("acknowledgements", "致谢")}
      {activeSection === "thesis_appendix" && body("appendix", "附录")}
      {activeSection === "thesis_references" && <ReferenceImporter referenceOrder={references.citationOrder} source={value.referencesBibtex} legacyReferences={[]} maximumEntries={200} maximumReferenceLength={2000} disabled={disabled} onChange={source => update({ referencesBibtex: source })} />}
    </div> : <>
      {activeSection === "thesis_cover" && <section className="grid gap-4"><h2 className="sr-only">封面</h2><DocumentDateField id="thesis-submission-date" label="封面提交日期" orientation="horizontal" placeholder="选择提交日期" value={value.submissionDate} minYear={2000} maxYear={2100} error={value.submissionDate && !parseDocumentDate(value.submissionDate, 2000, 2100) ? "日期无效，请选择 2000—2100 年内的提交日期。" : undefined} disabled={disabled} onChange={submissionDate => update({ submissionDate })} /></section>}
      {activeSection === "thesis_declaration" && <section className="flex items-center gap-3"><h2 className="sr-only">诚信声明</h2><Badge variant="secondary">模板生成</Badge></section>}
      {activeSection === "thesis_directory" && <section className="flex items-center gap-3"><h2 className="sr-only">目录</h2><Badge variant="secondary">自动生成</Badge></section>}
    </>}
    <Dialog open={deleteId !== null} onOpenChange={open => { if (!open) setDeleteId(null) }}><DialogContent><DialogHeader><DialogTitle>删除章节？</DialogTitle><DialogDescription>此章节及下级章节的正文都会删除，此操作无法撤销。</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDeleteId(null)}>取消</Button><Button variant="destructive" disabled={disabled} onClick={() => { const at = value.chapters.findIndex(c => c.id === deleteId); if (at >= 0) update({ chapters: [...value.chapters.slice(0, at), ...value.chapters.slice(chapterEnd(value.chapters, at))] }); setDeleteId(null); setSelectedId(null) }}><AnimatedActionIcon icon={DeleteIcon} />确认删除</Button></DialogFooter></DialogContent></Dialog>
  </>
}
