import { useState } from "react"
import type { Editor } from "@tiptap/react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import type { ThesisReferenceOption } from "@/lib/thesis-draft"
import { isEquation } from "@/lib/thesis-nodes"

export function ThesisInsertControls({ editor, references, disabled, equationSelected }: {
  editor: Editor; references: ThesisReferenceOption[]; disabled: boolean; equationSelected: boolean
}) {
  const [dialog, setDialog] = useState<{ kind: "equation" | "reference"; from: number; to: number; snapshot: string; id: string; editing: boolean } | null>(null)
  const [latex, setLatex] = useState("")
  const [target, setTarget] = useState("")
  const [error, setError] = useState("")
  const open = (kind: "equation" | "reference") => {
    const { from, to } = editor.state.selection
    const existing = kind === "equation" && editor.isActive("equationBlock") ? editor.getAttributes("equationBlock").block : null
    setLatex(existing?.latex ?? ""); setTarget(""); setError("")
    setDialog({ kind, from, to, snapshot: JSON.stringify(editor.getJSON()), id: existing?.id ?? `eq-${crypto.randomUUID()}`, editing: !!existing })
  }
  const selectedReference = references.find(r => `${r.kind}:${r.target}` === target)
  const save = () => {
    if (!dialog || disabled) return
    if (JSON.stringify(editor.getJSON()) !== dialog.snapshot) { setError("正文已变化，请取消后重新选择插入位置。"); return }
    const block = { type: "equation" as const, id: dialog.id, latex: latex.trim() }
    const reference = references.find(r => `${r.kind}:${r.target}` === target)
    if (dialog.kind === "equation" && !isEquation(block)) { setError("请填写公式 LaTeX 源码，最多 10000 字符。"); return }
    if (dialog.kind === "reference" && !reference) { setError("请选择有效的引用目标。"); return }
    const node = dialog.kind === "equation" ? { type: "equationBlock", attrs: { block } } : { type: "thesisReference", attrs: { kind: reference!.kind, target: reference!.target, label: reference!.label } }
    const inserted = editor.chain().focus().insertContentAt({ from: dialog.from, to: dialog.to }, dialog.kind === "equation" && !dialog.editing ? [node, { type: "paragraph" }] : node).run()
    if (!inserted) { setError("此处无法插入，请先选择正文段落。"); return }
    setDialog(null)
  }
  return <>
    <Button size="sm" variant="ghost" disabled={disabled || editor.isActive("listItem")} onClick={() => open("equation")}>{equationSelected ? "编辑公式" : "插入公式"}</Button>
    {equationSelected && <Button size="sm" variant="ghost" disabled={disabled} onClick={() => editor.chain().focus().deleteSelection().run()}>删除公式</Button>}
    <Button size="sm" variant="ghost" disabled={disabled || !references.length || equationSelected} onClick={() => open("reference")}>引用文献/公式</Button>
    <Dialog open={dialog !== null} onOpenChange={open => { if (!open) setDialog(null) }}><DialogContent>
      <DialogHeader><DialogTitle>{dialog?.kind === "equation" ? "公式" : "插入引用"}</DialogTitle><DialogDescription>{dialog?.kind === "equation" ? "输入 LaTeX 数学源码，例如 E=mc^{2}。编辑时显示源码，生成 PDF 预览后查看正式排版；仅支持常用数学命令。" : "文献按正文首次引用顺序编号，公式按章编号；引用始终绑定原目标。"}</DialogDescription></DialogHeader>
      {dialog?.kind === "equation" ? <label className="grid gap-2 text-sm">公式 LaTeX 源码<Textarea value={latex} maxLength={10000} onChange={e => setLatex(e.target.value)} /></label> : <Select value={target} onValueChange={value => setTarget(value ?? "")}><SelectTrigger aria-label="引用目标"><SelectValue>{selectedReference ? `${selectedReference.label} ${selectedReference.title}` : "选择文献或公式"}</SelectValue></SelectTrigger><SelectContent>{references.map(r => <SelectItem key={`${r.kind}:${r.target}`} value={`${r.kind}:${r.target}`}>{r.label} {r.title}</SelectItem>)}</SelectContent></Select>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button variant="outline" onClick={() => setDialog(null)}>取消</Button><Button disabled={disabled} onClick={save}>确认插入</Button></DialogFooter>
    </DialogContent></Dialog>
  </>
}
