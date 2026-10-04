import { FieldLabel } from "@/components/ui/field"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { FileTextIcon } from "@/components/ui/file-text"
import { CircleCheckIcon } from "@/components/ui/circle-check"
import { AnimatedActionIcon } from "@/components/animated-action-icon"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { parseOutlineText } from "@/lib/outline-import"
import { numberOutlineItems, type OutlineLevel } from "@/lib/outline-numbering"

export function OutlineImportDialog({ disabled, onImport }: {
  disabled: boolean
  onImport: (items: { level: OutlineLevel; title: string }[], replace: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const [mode, setMode] = useState("append")
  const [fileError, setFileError] = useState("")
  const parsed = useMemo(() => parseOutlineText(text), [text])
  const preview = numberOutlineItems(parsed.items.map(item => ({ ...item, number: "" })), "decimal_hierarchy")
  return <>
    <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setOpen(true)}><AnimatedActionIcon icon={FileTextIcon} />导入目录</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>导入目录</DialogTitle><DialogDescription>粘贴目录或选择 TXT 文件，核对下方预览后导入。</DialogDescription></DialogHeader>
        <FieldLabel  htmlFor="outline-import-file">读取 TXT 文件（可选）</FieldLabel>
        <Input id="outline-import-file" type="file" accept=".txt,text/plain" disabled={disabled} onChange={async event => {
          const file = event.target.files?.[0]
          event.target.value = ""
          if (!file) return
          if (file.size > 1_000_000) { setFileError("TXT 文件请控制在 1 MB 以内。"); return }
          try {
            const buffer = await file.arrayBuffer()
            let value: string
            try { value = new TextDecoder("utf-8", { fatal: true }).decode(buffer) }
            catch { value = new TextDecoder("gb18030", { fatal: true }).decode(buffer) }
            setText(value); setFileError("")
          } catch { setFileError("文件无法读取，请另存为 UTF-8 TXT，或直接粘贴目录。")}
        }} />
        <FieldLabel  htmlFor="outline-import-text">目录文本</FieldLabel>
        <Textarea id="outline-import-text" className="min-h-40 max-h-64" value={text} disabled={disabled} onChange={e => {setText(e.target.value); setFileError("")}} placeholder={"1 绪论\n1.1 研究背景\n1.2 研究现状\n1.2.1 国内研究现状\n2 研究方法"} />
        {fileError && <p role="alert" className="text-sm text-destructive">{fileError}</p>}
        {parsed.errors.length > 0 && <div role="alert" className="text-sm text-destructive">{parsed.errors.map(error => <p key={error}>{error}</p>)}</div>}
        <div className="rounded-lg border p-3 max-h-48 overflow-y-auto" aria-label="目录导入预览">
          <p className="text-sm font-medium">识别到 {preview.length} 条目录{parsed.skipped ? `，已略过 ${parsed.skipped} 个目录标题或固定项` : ""}</p>
          {preview.map((item, i) => <p key={i} className="text-sm leading-6">{item.number} {item.title}（{item.level} 级）</p>)}
        </div>
        <Select value={mode} onValueChange={v => v && setMode(v)} disabled={disabled}>
          <SelectTrigger aria-label="目录导入方式"><SelectValue>{mode === "replace" ? "替换现有可编辑目录" : "追加到现有目录"}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="append">追加到现有目录</SelectItem><SelectItem value="replace">替换现有可编辑目录</SelectItem></SelectContent>
        </Select>
        {mode === "replace" && <p className="text-sm text-muted-foreground">导入后会替换现有可编辑条目，摘要等固定项保留。</p>}
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>取消</Button><Button disabled={disabled || !preview.length || !!parsed.errors.length || !!fileError} onClick={() => { onImport(parsed.items, mode === "replace"); setOpen(false); setText(""); setFileError("") }}><AnimatedActionIcon icon={CircleCheckIcon} />确认导入</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
