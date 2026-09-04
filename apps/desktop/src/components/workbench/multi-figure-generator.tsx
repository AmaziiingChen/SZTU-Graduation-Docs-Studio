import { useEffect, useMemo, useRef, useState } from "react"
import { DragDropProvider } from "@dnd-kit/react"
import { isSortable, useSortable } from "@dnd-kit/react/sortable"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CopyIcon,
  DownloadIcon,
  GripVerticalIcon,
  ImagesIcon,
  InfoIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { LatexSourceSheet } from "@/components/workbench/latex-source-sheet"
import type { SaveState } from "@/components/workbench/save-status-badge"
import { ToolDraftActions } from "@/components/workbench/tool-draft-actions"
import { writeClipboardText } from "@/lib/desktop-clipboard"
import { generateMultiFigureLatex, validateFigureFilenames } from "@/lib/multi-figure"
import {
  clearMultiFigureSessionImages,
  getMultiFigureSessionImages,
  setMultiFigureSessionImages,
  type SessionFigureItem,
} from "@/lib/multi-figure-session"
import { useLocalDraft } from "@/lib/use-local-draft"
import { cn } from "@/lib/utils"

type MultiFigureDraft = {
  columns: number
  caption: string
  label: string
  pathPrefix: string
  images: Array<{ filename: string; caption: string }>
}

let imageSequence = 0

const previewGridClasses: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
}

const storageKey = "sztu-docs.thesis-tools.multi-figure.v1"
const initialDraft: MultiFigureDraft = {
  columns: 2,
  caption: "",
  label: "",
  pathPrefix: "figures",
  images: [],
}

function isMultiFigureDraft(value: unknown): value is MultiFigureDraft {
  if (!value || typeof value !== "object") return false
  const draft = value as Record<string, unknown>
  return typeof draft.columns === "number" &&
    Number.isInteger(draft.columns) &&
    draft.columns >= 1 &&
    draft.columns <= 4 &&
    typeof draft.caption === "string" &&
    typeof draft.label === "string" &&
    typeof draft.pathPrefix === "string" &&
    Array.isArray(draft.images) &&
    draft.images.every((item) => {
      if (!item || typeof item !== "object") return false
      const image = item as Record<string, unknown>
      return typeof image.filename === "string" && typeof image.caption === "string"
    })
}

function moveItem(items: SessionFigureItem[], from: number, to: number): SessionFigureItem[] {
  if (to < 0 || to >= items.length) return items
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

type SortableFigureRowProps = {
  item: SessionFigureItem
  index: number
  selected: boolean
  last: boolean
  onSelect: () => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
}

function SortableFigureRow({
  item,
  index,
  selected,
  last,
  onSelect,
  onMove,
  onRemove,
}: SortableFigureRowProps) {
  const { ref, handleRef, isDragging } = useSortable({
    id: item.id,
    index,
  })

  return (
    <div
      ref={ref}
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1 rounded-lg border p-1",
        selected && "border-foreground",
        isDragging && "opacity-50",
      )}
    >
      <Button
        ref={handleRef}
        type="button"
        variant="ghost"
        size="icon-sm"
        className="cursor-grab touch-none active:cursor-grabbing"
        aria-label={`拖动图片 ${index + 1} 调整顺序`}
      >
        <GripVerticalIcon />
      </Button>
      <button
        type="button"
        className="grid min-w-0 grid-cols-[3rem_minmax(0,1fr)] items-center gap-3 rounded-md px-1 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`选择图片 ${index + 1} 进行编辑`}
        aria-pressed={selected}
        onClick={onSelect}
      >
        <img src={item.previewUrl} alt="" aria-hidden="true" className="size-12 rounded-md border object-cover" />
        <span className="min-w-0">
          <span className="block text-sm font-medium">图片 {index + 1}</span>
          <span className="block truncate text-xs text-muted-foreground" title={item.file.name}>{item.file.name}</span>
        </span>
      </button>
      <div className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`上移图片 ${index + 1}`} disabled={index === 0} onClick={() => onMove(-1)}><ArrowUpIcon /></Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`下移图片 ${index + 1}`} disabled={last} onClick={() => onMove(1)}><ArrowDownIcon /></Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`删除图片 ${index + 1}`} onClick={onRemove}><Trash2Icon /></Button>
      </div>
    </div>
  )
}

export function MultiFigureGenerator({
  onSaveStateChange,
}: {
  onSaveStateChange?: (state: SaveState) => void
} = {}) {
  const { value: draft, setValue: setDraft, clearDraft } = useLocalDraft({
    storageKey,
    initialValue: initialDraft,
    isValid: isMultiFigureDraft,
    onSaveStateChange,
  })
  const { columns, caption, label, pathPrefix } = draft
  const [images, setImages] = useState<SessionFigureItem[]>(getMultiFigureSessionImages)
  const [selectedImageId, setSelectedImageId] = useState<string | null>(() => getMultiFigureSessionImages()[0]?.id ?? null)
  const objectUrls = useRef(new Set(images.map((item) => item.previewUrl)))
  const selectedImage = images.find((item) => item.id === selectedImageId) ?? images[0] ?? null
  const selectedIndex = selectedImage ? images.findIndex((item) => item.id === selectedImage.id) : -1
  const filenameErrors = useMemo(
    () => validateFigureFilenames(images.map((item) => ({ filename: item.file.name }))),
    [images],
  )

  useEffect(() => {
    const releaseImages = () => {
      clearMultiFigureSessionImages().forEach((item) => URL.revokeObjectURL(item.previewUrl))
      objectUrls.current.clear()
    }
    window.addEventListener("beforeunload", releaseImages)
    return () => window.removeEventListener("beforeunload", releaseImages)
  }, [])

  const applyImages = (next: SessionFigureItem[]) => {
    setMultiFigureSessionImages(next)
    setImages(next)
    setDraft((current) => ({
      ...current,
      images: next.map((item) => ({ filename: item.file.name, caption: item.caption })),
    }))
  }

  const addImages = (files: FileList | null) => {
    if (!files) return
    const accepted = Array.from(files).filter((file) => file.type.startsWith("image/"))
    const room = Math.max(0, 12 - images.length)
    const additions = accepted.slice(0, room).map((file) => {
      const previewUrl = URL.createObjectURL(file)
      objectUrls.current.add(previewUrl)
      imageSequence += 1
      const restoredCaption = draft.images.find((item) => item.filename === file.name)?.caption ?? ""
      return { id: `figure-${imageSequence}`, file, previewUrl, caption: restoredCaption }
    })
    applyImages([...images, ...additions])
    if (additions[0]) setSelectedImageId(additions[0].id)
    if (accepted.length > room) toast.error("一次排版最多支持 12 张图片。")
  }

  const removeImage = (id: string) => {
    const index = images.findIndex((item) => item.id === id)
    const target = images[index]
    if (target) {
      URL.revokeObjectURL(target.previewUrl)
      objectUrls.current.delete(target.previewUrl)
    }
    const next = images.filter((item) => item.id !== id)
    applyImages(next)
    if (selectedImageId === id) setSelectedImageId(next[Math.min(index, next.length - 1)]?.id ?? null)
  }

  const clearAll = () => {
    clearMultiFigureSessionImages().forEach((item) => URL.revokeObjectURL(item.previewUrl))
    objectUrls.current.clear()
    setImages([])
    setSelectedImageId(null)
    clearDraft()
  }

  const latex = useMemo(
    () => filenameErrors.length === 0
      ? generateMultiFigureLatex({
          images: images.map((item) => ({ filename: item.file.name, caption: item.caption })),
          columns,
          caption,
          label,
          pathPrefix,
        })
      : "",
    [caption, columns, filenameErrors.length, images, label, pathPrefix],
  )
  const packages = images.length > 1 ? ["graphicx", "subcaption"] : ["graphicx"]

  const copyLatex = async () => {
    if (!latex) return
    try {
      await writeClipboardText(latex)
      toast.success("LaTeX 源码已复制。")
    } catch {
      toast.error("源码复制失败，请在“查看 LaTeX”中手动复制。")
    }
  }

  const downloadLatex = () => {
    if (!latex) return
    const url = URL.createObjectURL(new Blob([latex], { type: "text/plain;charset=utf-8" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "multi-figure.tex"
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <ScrollArea className="h-full">
      <main className="mx-auto grid w-full max-w-6xl gap-6 p-6" aria-label="多图排版">
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle>图片与布局</CardTitle>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label="图片使用说明" />}>
                      <InfoIcon />
                    </TooltipTrigger>
                    <TooltipContent>图片只用于本机预览，不会上传；一次最多选择 12 张。</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <CardAction>
                <ToolDraftActions draftName="多图排版" onClear={clearAll} />
              </CardAction>
            </CardHeader>
            <CardContent className="grid gap-5">
              <Input type="file" accept="image/*" multiple aria-label="选择图片" onChange={(event) => {
                addImages(event.target.files)
                event.target.value = ""
              }} />
              {images.length === 0 && draft.images.length > 0 ? (
                <Alert>
                  <AlertTitle>重新选择图片以恢复预览</AlertTitle>
                  <AlertDescription>上次的布局和 {draft.images.length} 张图片标题已保留。</AlertDescription>
                </Alert>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="grid gap-2 text-sm font-medium">
                  每行图片数
                  <Select value={String(columns)} onValueChange={(value) => setDraft((current) => ({ ...current, columns: Number(value) }))}>
                    <SelectTrigger aria-label="每行图片数"><span>{columns} 张</span></SelectTrigger>
                    <SelectContent>{[1, 2, 3, 4].map((count) => <SelectItem key={count} value={String(count)}>{count} 张</SelectItem>)}</SelectContent>
                  </Select>
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  图片目录
                  <Input value={pathPrefix} onChange={(event) => setDraft((current) => ({ ...current, pathPrefix: event.target.value }))} placeholder="figures" />
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  整组图题（可选）
                  <Input value={caption} onChange={(event) => setDraft((current) => ({ ...current, caption: event.target.value }))} />
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  引用标签（可选）
                  <Input value={label} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} placeholder="fig:experiment" />
                </label>
              </div>

              {images.length > 0 ? (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
                  <DragDropProvider
                    onDragEnd={(event) => {
                      if (event.canceled) return
                      const { source } = event.operation
                      if (!isSortable(source)) return
                      const { initialIndex, index } = source
                      if (initialIndex === index) return
                      applyImages(moveItem(images, initialIndex, index))
                    }}
                  >
                    <div className="grid gap-2" aria-label="图片顺序">
                      {images.map((item, index) => (
                        <SortableFigureRow
                          key={item.id}
                          item={item}
                          index={index}
                          selected={selectedImage?.id === item.id}
                          last={index === images.length - 1}
                          onSelect={() => setSelectedImageId(item.id)}
                          onMove={(direction) => applyImages(moveItem(images, index, index + direction))}
                          onRemove={() => removeImage(item.id)}
                        />
                      ))}
                    </div>
                  </DragDropProvider>
                  {selectedImage ? (
                    <div className="grid content-start gap-3 rounded-lg border p-4">
                      <img src={selectedImage.previewUrl} alt={`当前编辑图片 ${selectedIndex + 1}`} className="aspect-4/3 w-full rounded-md border object-contain" />
                      <label className="grid gap-2 text-sm font-medium">
                        图片 {selectedIndex + 1} 子标题（可选）
                        <Input value={selectedImage.caption} aria-label={`图片 ${selectedIndex + 1} 子标题`} onChange={(event) => applyImages(images.map((image) => image.id === selectedImage.id ? { ...image, caption: event.target.value } : image))} />
                      </label>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {filenameErrors.length > 0 ? (
                <Alert variant="destructive">
                  <AlertTitle>图片暂时无法生成源码</AlertTitle>
                  <AlertDescription><ul className="list-disc space-y-1 pl-4">{filenameErrors.map((error) => <li key={error}>{error}</li>)}</ul></AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
              <CardTitle>排版预览</CardTitle>
              <div className="flex shrink-0 flex-wrap gap-2">
                <LatexSourceSheet latex={latex} packages={packages} />
                <Button type="button" size="sm" variant="outline" disabled={!latex} onClick={() => void copyLatex()}><CopyIcon />复制源码</Button>
                <Button type="button" size="sm" disabled={!latex} onClick={downloadLatex}><DownloadIcon />下载源码</Button>
              </div>
            </CardHeader>
            <CardContent>
              {images.length > 0 ? (
                <figure className="rounded-lg border bg-background p-6">
                  <div className={`grid items-start gap-4 ${previewGridClasses[columns]}`}>
                    {images.map((item, index) => (
                      <div key={item.id} className="grid gap-2 text-center">
                        <div className="flex aspect-4/3 items-center justify-center overflow-hidden rounded-md border">
                          <img src={item.previewUrl} alt={`图片 ${index + 1} 预览`} className="max-h-full max-w-full object-contain" />
                        </div>
                        {images.length > 1 && item.caption.trim() ? <p className="text-xs">（{String.fromCharCode(97 + index)}）{item.caption.trim()}</p> : null}
                      </div>
                    ))}
                  </div>
                  {caption.trim() ? <figcaption className="mt-4 text-center text-sm font-medium">{caption.trim()}</figcaption> : null}
                </figure>
              ) : (
                <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  <ImagesIcon className="size-8" />
                  选择图片后在这里预览组合效果。
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </ScrollArea>
  )
}
