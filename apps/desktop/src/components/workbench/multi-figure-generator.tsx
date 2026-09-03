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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { LatexSourceCard } from "@/components/workbench/latex-source-card"
import { generateMultiFigureLatex, validateFigureFilenames } from "@/lib/multi-figure"

type FigureItem = {
  id: string
  file: File
  previewUrl: string
  caption: string
}

let imageSequence = 0

const previewGridClasses: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
}

function moveItem(items: FigureItem[], from: number, to: number): FigureItem[] {
  if (to < 0 || to >= items.length) return items
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export function MultiFigureGenerator() {
  const [images, setImages] = useState<FigureItem[]>([])
  const [columns, setColumns] = useState(2)
  const [caption, setCaption] = useState("")
  const [label, setLabel] = useState("")
  const [pathPrefix, setPathPrefix] = useState("figures")
  const objectUrls = useRef(new Set<string>())
  const filenameErrors = useMemo(
    () => validateFigureFilenames(images.map((item) => ({ filename: item.file.name }))),
    [images],
  )

  useEffect(() => () => {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url))
    objectUrls.current.clear()
  }, [])

  const addImages = (files: FileList | null) => {
    if (!files) return
    const accepted = Array.from(files).filter((file) => file.type.startsWith("image/"))
    const room = Math.max(0, 12 - images.length)
    const additions = accepted.slice(0, room).map((file) => {
      const previewUrl = URL.createObjectURL(file)
      objectUrls.current.add(previewUrl)
      imageSequence += 1
      return { id: `figure-${imageSequence}`, file, previewUrl, caption: "" }
    })
    setImages((current) => [...current, ...additions])
    if (accepted.length > room) toast.error("一次排版最多支持 12 张图片。")
  }

  const removeImage = (id: string) => {
    setImages((current) => {
      const target = current.find((item) => item.id === id)
      if (target) {
        URL.revokeObjectURL(target.previewUrl)
        objectUrls.current.delete(target.previewUrl)
      }
      return current.filter((item) => item.id !== id)
    })
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
        <div className="space-y-1">
          <h2 id="multi-figure-title" className="text-xl font-semibold">多图排版</h2>
          <p className="text-sm text-muted-foreground">
            选择本机图片、调整顺序和列数，生成 figure 与 subfigure 源码。
          </p>
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
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-medium">
                  每行图片数
                  <Select value={String(columns)} onValueChange={(value) => setColumns(Number(value))}>
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
                    onChange={(event) => setPathPrefix(event.target.value)}
                    placeholder="figures"
                  />
                </label>
              </div>
              <label className="grid gap-2 text-sm font-medium">
                整组图题（可选）
                <Input value={caption} onChange={(event) => setCaption(event.target.value)} />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                引用标签（可选）
                <Input
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
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
                          onChange={(event) => setImages((current) => current.map((image) =>
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
                          onClick={() => setImages((current) => moveItem(current, index, index - 1))}
                        >
                          <ArrowUpIcon />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`下移图片 ${index + 1}`}
                          disabled={index === images.length - 1}
                          onClick={() => setImages((current) => moveItem(current, index, index + 1))}
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
