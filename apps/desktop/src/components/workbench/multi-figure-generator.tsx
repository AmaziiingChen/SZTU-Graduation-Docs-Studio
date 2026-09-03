import { useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ImagesIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

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
import { SaveStatusBadge } from "@/components/workbench/save-status-badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { LatexSourceCard } from "@/components/workbench/latex-source-card"
import { ToolDraftActions } from "@/components/workbench/tool-draft-actions"
import { generateMultiFigureLatex, validateFigureFilenames } from "@/lib/multi-figure"
import {
  clearMultiFigureSessionImages,
  getMultiFigureSessionImages,
  setMultiFigureSessionImages,
  type SessionFigureItem,
} from "@/lib/multi-figure-session"
import { useLocalDraft } from "@/lib/use-local-draft"

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

export function MultiFigureGenerator() {
  const { value: draft, setValue: setDraft, saveState, clearDraft } = useLocalDraft({
    storageKey,
    initialValue: initialDraft,
    isValid: isMultiFigureDraft,
  })
  const { columns, caption, label, pathPrefix } = draft
  const [images, setImages] = useState<SessionFigureItem[]>(getMultiFigureSessionImages)
  const objectUrls = useRef(new Set(images.map((item) => item.previewUrl)))
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
    if (accepted.length > room) toast.error("一次排版最多支持 12 张图片。")
  }

  const removeImage = (id: string) => {
    const target = images.find((item) => item.id === id)
    if (target) {
      URL.revokeObjectURL(target.previewUrl)
      objectUrls.current.delete(target.previewUrl)
    }
    applyImages(images.filter((item) => item.id !== id))
  }

  const clearAll = () => {
    clearMultiFigureSessionImages().forEach((item) => URL.revokeObjectURL(item.previewUrl))
    objectUrls.current.clear()
    setImages([])
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

  return (
    <ScrollArea className="h-full">
      <main className="mx-auto grid w-full max-w-6xl gap-6 p-6" aria-labelledby="multi-figure-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="multi-figure-title" className="text-xl font-semibold">多图排版</h2>
              <SaveStatusBadge state={saveState} />
            </div>
            <p className="text-sm text-muted-foreground">
              选择本机图片、调整顺序和列数，生成 figure 与 subfigure 源码。
            </p>
          </div>
          <ToolDraftActions saveState={saveState} draftName="多图排版" onClear={clearAll} showSaveStatus={false} />
        </div>

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(20rem,0.85fr)_minmax(28rem,1.15fr)]">
          <Card>
            <CardHeader>
              <CardTitle>图片与布局</CardTitle>
              <CardDescription>图片只用于本机预览，不会上传或保存到工作台。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Input
                type="file"
                accept="image/*"
                multiple
                aria-label="选择图片"
                onChange={(event) => {
                  addImages(event.target.files)
                  event.target.value = ""
                }}
              />
              {images.length === 0 && draft.images.length > 0 ? (
                <p className="text-sm text-muted-foreground">
                  已恢复上次的布局和 {draft.images.length} 张图片信息；重新选择原图片后可继续预览。
                </p>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-medium">
                  每行图片数
                  <Select value={String(columns)} onValueChange={(value) => setDraft((current) => ({ ...current, columns: Number(value) }))}>
                    <SelectTrigger aria-label="每行图片数"><span>{columns} 张</span></SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4].map((count) => (
                        <SelectItem key={count} value={String(count)}>{count} 张</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  图片目录
                  <Input
                    value={pathPrefix}
                    onChange={(event) => setDraft((current) => ({ ...current, pathPrefix: event.target.value }))}
                    placeholder="figures"
                  />
                </label>
              </div>
              <label className="grid gap-2 text-sm font-medium">
                整组图题（可选）
                <Input value={caption} onChange={(event) => setDraft((current) => ({ ...current, caption: event.target.value }))} />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                引用标签（可选）
                <Input
                  value={label}
                  onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
                  placeholder="例如：fig:experiment"
                />
              </label>

              {images.length > 0 ? (
                <div className="grid gap-2" aria-label="图片顺序">
                  {images.map((item, index) => (
                    <div key={item.id} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border p-2">
                      <img
                        src={item.previewUrl}
                        alt=""
                        aria-hidden="true"
                        className="size-12 rounded-md border object-cover"
                      />
                      <div className="min-w-0 space-y-2">
                        <p className="truncate text-xs text-muted-foreground" title={item.file.name}>{item.file.name}</p>
                        <Input
                          value={item.caption}
                          aria-label={`图片 ${index + 1} 子标题`}
                          placeholder="子标题（可选）"
                          onChange={(event) => applyImages(images.map((image) =>
                            image.id === item.id ? { ...image, caption: event.target.value } : image,
                          ))}
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`上移图片 ${index + 1}`}
                          disabled={index === 0}
                          onClick={() => applyImages(moveItem(images, index, index - 1))}
                        >
                          <ArrowUpIcon />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`下移图片 ${index + 1}`}
                          disabled={index === images.length - 1}
                          onClick={() => applyImages(moveItem(images, index, index + 1))}
                        >
                          <ArrowDownIcon />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`删除图片 ${index + 1}`}
                          onClick={() => removeImage(item.id)}
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {filenameErrors.length > 0 ? (
                <Alert variant="destructive">
                  <AlertTitle>图片暂时无法生成源码</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc space-y-1 pl-4">
                      {filenameErrors.map((error) => <li key={error}>{error}</li>)}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>排版预览</CardTitle>
              <CardDescription>预览展示图片比例和分组关系，论文模板负责最终页宽与题注字号。</CardDescription>
            </CardHeader>
            <CardContent>
              {images.length > 0 ? (
                <figure className="rounded-lg border p-4">
                  <div className={`grid items-start gap-4 ${previewGridClasses[columns]}`}>
                    {images.map((item, index) => (
                      <div key={item.id} className="grid gap-2 text-center">
                        <div className="flex aspect-4/3 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
                          <img
                            src={item.previewUrl}
                            alt={`图片 ${index + 1} 预览`}
                            className="max-h-full max-w-full object-contain"
                          />
                        </div>
                        {images.length > 1 && item.caption.trim() ? (
                          <p className="text-xs">（{String.fromCharCode(97 + index)}）{item.caption.trim()}</p>
                        ) : null}
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

        <LatexSourceCard
          latex={latex}
          filename="multi-figure.tex"
          packages={images.length > 1 ? ["graphicx", "subcaption"] : ["graphicx"]}
        />
      </main>
    </ScrollArea>
  )
}
