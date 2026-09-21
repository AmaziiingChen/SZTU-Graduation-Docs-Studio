import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { VisualTableEditor, type EditableTableValue } from "@/components/workbench/visual-table-editor"
import { parseTableText } from "@/lib/three-line-table"
import { managedFigurePreviewUrl } from "@/lib/structured-content-editor"
import type { ParagraphInput, StructuredToolBlock } from "@/types/structured-content"
import type { SztuDesktopApi } from "@/types/desktop-api"

const text = (value?: ParagraphInput) => typeof value === "string" ? value : value?.runs.map(run => run.text).join("") ?? ""
const preserve = (value: ParagraphInput | undefined, next: string): ParagraphInput => value !== undefined && text(value) === next ? value : next

export function BodyToolDialog({ value, chapters, onCancel, onSave }: {
  value: StructuredToolBlock
  chapters: { value: number; label: string }[]
  onCancel: () => void
  onSave: (value: StructuredToolBlock) => void
}) {
  const [draft, setDraft] = useState(value)
  const [caption, setCaption] = useState(text(value.caption))
  const [table, setTable] = useState<EditableTableValue>(() => value.type === "data_table" ? {
    source: [value.columns.map(col => text(col.header)), ...value.rows.map(row => row.cells.map(text))].map(row => row.join("\t")).join("\n"),
    rowCount: value.rows.length + 1, columnCount: value.columns.length,
  } : { source: "" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const importing = useRef(false)
  const group = draft.type === "figure_group" ? draft : null
  const title = group ? "多图排版" : draft.type === "data_table" && draft.style === "three_line" ? "三线表" : "表格"
  const addImages = async () => {
    if (!group || importing.current) return
    const api = (window as Window & { sztuDesktop?: SztuDesktopApi }).sztuDesktop
    if (!api) { setError("请在桌面应用中选择本机图片。"); return }
    importing.current = true
    setBusy(true); setError("")
    try {
      const assets = api.importImageAssets ? await api.importImageAssets() : [await api.importImageAsset()].filter(asset => asset !== null)
      if (assets.length + group.items.length > 4) { setError(`当前还能添加 ${4 - group.items.length} 张图片，请重新选择。`); return }
      setDraft({ ...group, items: [...group.items, ...assets.map(asset => ({ path: asset.path, alt: asset.originalName.replace(/\.[^.]+$/, "") }))] })
    } catch (err) { setError(err instanceof Error ? err.message : "图片导入失败，请重试。") }
    finally { importing.current = false; setBusy(false) }
  }
  const move = (index: number, offset: number) => {
    if (!group) return
    const items = [...group.items]; [items[index], items[index + offset]] = [items[index + offset], items[index]]
    setDraft({ ...group, items })
  }
  const save = () => {
    setError("")
    if (group) {
      if (group.items.length < 2 || !caption.trim()) { setError("请选择 2–4 张图片，并填写总图题。"); return }
      onSave({ ...group, caption: preserve(value.caption, caption.trim()) }); return
    }
    if (draft.type !== "data_table") return
    const parsed = parseTableText(table.source).rows
    const rowCount = Math.max(table.rowCount ?? 0, parsed.length)
    const columnCount = Math.max(table.columnCount ?? 0, ...parsed.map(row => row.length))
    if (rowCount < 2 || rowCount > 41 || columnCount < 2 || columnCount > 8) { setError("表格需要 2–8 列，包含一行表头和 1–40 行数据。"); return }
    const rows = Array.from({ length: rowCount }, (_, i) => Array.from({ length: columnCount }, (_, j) => parsed[i]?.[j]?.trim() ?? ""))
    if (rows.some(row => row.some(cell => !cell))) { setError("请补齐表头和单元格；没有数据的位置可填写“—”。"); return }
    onSave({ ...draft,
      columns: rows[0].map((header, index) => ({ ...draft.columns[index], header: preserve(draft.columns[index]?.header, header) })),
      rows: rows.slice(1).map((cells, i) => ({ cells: cells.map((cell, j) => preserve(draft.rows[i]?.cells[j], cell)) })),
      caption: caption.trim() ? preserve(value.caption, caption.trim()) : undefined,
    })
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onCancel() }}>
    <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-4xl">
      <DialogHeader className="shrink-0"><DialogTitle>{title}</DialogTitle><DialogDescription>确认后插入正文；点击已插入的内容可以重新编辑。取消不会更改正文。</DialogDescription></DialogHeader>
      <div className="min-h-0 overflow-y-auto"><fieldset disabled={busy} className="grid min-w-0 gap-4">
        <label className="grid gap-2 text-sm font-medium">{group ? "总图题" : "表题（可选）"}<Input value={caption} maxLength={500} onChange={event => setCaption(event.target.value)} /></label>
        {group ? <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-2 text-sm">所属章节<Select value={String(group.chapter ?? 1)} onValueChange={chapter => setDraft({ ...group, chapter: Number(chapter) })}><SelectTrigger><SelectValue>{chapters.find(item => item.value === group.chapter)?.label ?? `第 ${group.chapter ?? 1} 章`}</SelectValue></SelectTrigger><SelectContent>{chapters.map(chapter => <SelectItem key={chapter.value} value={String(chapter.value)}>{chapter.label}</SelectItem>)}</SelectContent></Select></label>
            <label className="grid gap-2 text-sm">每行张数<Select value={String(group.columns ?? 2)} onValueChange={columns => setDraft({ ...group, columns: Number(columns) })}><SelectTrigger><SelectValue>{group.columns ?? 2} 张</SelectValue></SelectTrigger><SelectContent>{[1, 2, 3, 4].map(count => <SelectItem key={count} value={String(count)}>{count} 张</SelectItem>)}</SelectContent></Select></label>
            <Button variant="outline" disabled={busy || group.items.length >= 4} onClick={() => void addImages()}>{busy ? "正在导入…" : "添加图片"}</Button><span className="text-sm text-muted-foreground">{group.items.length}/4 张</span>
          </div>
          <div className={`grid gap-4 ${["", "grid-cols-1", "grid-cols-2", "grid-cols-3", "grid-cols-4"][group.columns ?? 2]}`}>
            {group.items.map((item, index) => <div key={`${item.path}-${index}`} className="grid content-start gap-2 rounded-lg border p-3">
              <img className="h-40 w-full object-contain" src={managedFigurePreviewUrl(item.path)} alt={item.alt} />
              <label className="grid gap-1 text-sm">子图 ({String.fromCharCode(97 + index)}) 说明<Input value={text(item.caption)} maxLength={500} onChange={event => setDraft({ ...group, items: group.items.map((entry, i) => i === index ? { ...entry, caption: event.target.value || undefined } : entry) })} /></label>
              <div className="flex flex-wrap gap-1"><Button size="sm" variant="ghost" disabled={index === 0 || busy} onClick={() => move(index, -1)}>前移</Button><Button size="sm" variant="ghost" disabled={index === group.items.length - 1 || busy} onClick={() => move(index, 1)}>后移</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setDraft({ ...group, items: group.items.filter((_, i) => i !== index) })}>移除</Button></div>
            </div>)}
          </div>
          {!group.items.length ? <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">添加 2–4 张图片，可一次选择多张。图片会按上方布局作为一个整体插入。</p> : null}
        </> : <><p className="text-sm text-muted-foreground">第一行作为表头。可直接粘贴 Excel 数据，最多 8 列、40 行数据。</p><VisualTableEditor value={table} onChange={setTable} exampleData="项目\t结果\n样本 A\t10\n样本 B\t12" /></>}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </fieldset></div>
      <DialogFooter className="shrink-0"><Button variant="outline" disabled={busy} onClick={onCancel}>取消</Button><Button disabled={busy} onClick={save}>确认{title}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
