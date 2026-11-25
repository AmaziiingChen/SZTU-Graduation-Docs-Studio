import * as React from "react"
import {
  ArrowLeftIcon,
  BookOpenIcon,
  HistoryIcon,
  KeyboardIcon,
  MessageSquareIcon,
  SearchIcon,
  SparklesIcon,
  TrashIcon,
} from "lucide-react"

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
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  helpArticles,
  helpCategories,
  keyboardShortcuts,
  releaseNotes,
  searchHelp,
  type HelpArticle,
  type HelpCategoryId,
} from "@/data/help-content"
import { cn } from "@/lib/utils"

type HelpTab = "help" | "shortcuts" | "releases"

const TAB_LABELS: Array<{ id: HelpTab; label: string }> = [
  { id: "help", label: "常见问题" },
  { id: "shortcuts", label: "快捷键" },
  { id: "releases", label: "更新说明" },
]

function categoryLabel(id: HelpCategoryId): string {
  return helpCategories.find((category) => category.id === id)?.label ?? "其他"
}

function ArticleBody({ article }: { article: HelpArticle }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {article.body.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  )
}

export type HelpCenterDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialArticleId?: string | null
  demoBusy?: boolean
  onInstallDemo: () => void | Promise<void>
  onRemoveDemo: () => void | Promise<void>
  onReplayTour: () => void
  onOpenFeedback: () => void
}

export function HelpCenterDialog({
  open,
  onOpenChange,
  initialArticleId,
  demoBusy = false,
  onInstallDemo,
  onRemoveDemo,
  onReplayTour,
  onOpenFeedback,
}: HelpCenterDialogProps) {
  const [tab, setTab] = React.useState<HelpTab>("help")
  const [query, setQuery] = React.useState("")
  const [categoryId, setCategoryId] = React.useState<HelpCategoryId | "all">("all")
  const [selectedArticleId, setSelectedArticleId] = React.useState<string | null>(null)

  const initialArticle = initialArticleId
    ? helpArticles.find((article) => article.id === initialArticleId) ?? null
    : null
  const selectedArticle = selectedArticleId
    ? helpArticles.find((article) => article.id === selectedArticleId) ?? null
    : initialArticle && !selectedArticleId
      ? initialArticle
      : null

  const hits = React.useMemo(() => {
    const results = searchHelp(query)
    return categoryId === "all"
      ? results
      : results.filter((hit) => hit.article.category === categoryId)
  }, [categoryId, query])

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setSelectedArticleId(null)
      setQuery("")
      setCategoryId("all")
      setTab("help")
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex h-[min(82vh,660px)] flex-col gap-0 p-0 sm:max-w-4xl">
        <DialogHeader className="gap-1 border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <BookOpenIcon className="size-4" aria-hidden="true" />
            帮助与支持
          </DialogTitle>
          <DialogDescription>
            常见问题、快捷键、更新说明，以及可随时载入的演示资料。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1 border-b px-3 py-2">
          {TAB_LABELS.map((item) => (
            <Button
              key={item.id}
              type="button"
              variant={tab === item.id ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={tab === item.id}
              onClick={() => {
                setTab(item.id)
                setSelectedArticleId(null)
              }}
            >
              {item.id === "shortcuts" ? <KeyboardIcon aria-hidden="true" /> : null}
              {item.id === "releases" ? <HistoryIcon aria-hidden="true" /> : null}
              {item.label}
            </Button>
          ))}
        </div>

        {tab === "help" ? (
          <div className="grid min-h-0 flex-1 grid-cols-[180px_minmax(0,1fr)]">
            <div className="min-h-0 border-r p-3">
              <ScrollArea className="h-full pr-1">
                <nav className="space-y-1" aria-label="帮助分类">
                  <Button
                    type="button"
                    variant={categoryId === "all" ? "secondary" : "ghost"}
                    size="sm"
                    className="w-full justify-start"
                    aria-pressed={categoryId === "all"}
                    onClick={() => {
                      setCategoryId("all")
                      setSelectedArticleId(null)
                    }}
                  >
                    全部
                  </Button>
                  {helpCategories.map((category) => (
                    <Button
                      key={category.id}
                      type="button"
                      variant={categoryId === category.id ? "secondary" : "ghost"}
                      size="sm"
                      className="w-full justify-start"
                      aria-pressed={categoryId === category.id}
                      onClick={() => {
                        setCategoryId(category.id)
                        setSelectedArticleId(null)
                      }}
                    >
                      {category.label}
                    </Button>
                  ))}
                </nav>
              </ScrollArea>
            </div>

            <div className="flex min-h-0 flex-col">
              <div className="flex items-center gap-2 border-b px-4 py-2">
                <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <Input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setSelectedArticleId(null)
                  }}
                  placeholder="搜索：文献、字体、导出、更新……"
                  aria-label="搜索帮助"
                  className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                />
              </div>

              <ScrollArea className="min-h-0 flex-1">
                {selectedArticle ? (
                  <div className="space-y-4 p-4">
                    <div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="mb-2 -ml-2"
                        onClick={() => setSelectedArticleId(null)}
                      >
                        <ArrowLeftIcon aria-hidden="true" />
                        返回全部
                      </Button>
                      <h3 className="text-base font-semibold">{selectedArticle.title}</h3>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">{categoryLabel(selectedArticle.category)}</Badge>
                        <span>{selectedArticle.summary}</span>
                      </div>
                    </div>
                    <ArticleBody article={selectedArticle} />
                    {selectedArticle.id === "demo-documents" ? (
                      <DemoActions busy={demoBusy} onInstall={onInstallDemo} onRemove={onRemoveDemo} />
                    ) : null}
                  </div>
                ) : hits.length === 0 ? (
                  <div className="p-6 text-sm text-muted-foreground">
                    没有找到匹配的内容。换个关键词（例如“字体”“导出”“更新”）再试。
                  </div>
                ) : (
                  <ul className="divide-y">
                    {hits.map(({ article, snippet }) => (
                      <li key={article.id}>
                        <Button
                          type="button"
                          variant="ghost"
                          className="flex h-auto w-full flex-col items-start gap-1 rounded-none px-4 py-3 text-left whitespace-normal"
                          onClick={() => setSelectedArticleId(article.id)}
                        >
                          <span className="flex w-full items-center justify-between gap-2">
                            <span className="text-sm font-medium">{article.title}</span>
                            <Badge variant="outline" className="shrink-0">
                              {categoryLabel(article.category)}
                            </Badge>
                          </span>
                          <span className="text-xs font-normal text-muted-foreground">{snippet}</span>
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollArea>

              <div className="border-t p-3">
                <DemoActions busy={demoBusy} onInstall={onInstallDemo} onRemove={onRemoveDemo} />
              </div>
            </div>
          </div>
        ) : null}

        {tab === "shortcuts" ? (
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-4 p-5">
              <p className="text-sm text-muted-foreground">
                这些快捷键在应用内随时可用；弹窗打开时 Esc 优先关闭弹窗。
              </p>
              <ul className="divide-y rounded-lg border">
                {keyboardShortcuts.map((shortcut) => (
                  <li key={shortcut.keys} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="text-sm">{shortcut.action}</span>
                    <Kbd>{shortcut.keys}</Kbd>
                  </li>
                ))}
              </ul>
              <div className="rounded-lg border bg-muted/40 p-4 text-sm">
                <p className="font-medium">写作页还可以这样用</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                  <li>工具栏的 B / I / 上下标用于选中文字后设置格式。</li>
                  <li>保存是自动的，底部会显示「已保存」；也可以按 Ctrl + S 手动保存一次。</li>
                  <li>右侧结构提示里的灰项表示还没填，点它可以直接跳到对应章节。</li>
                </ul>
              </div>
            </div>
          </ScrollArea>
        ) : null}

        {tab === "releases" ? (
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-5 p-5">
              {releaseNotes.map((note) => (
                <section key={note.version} className="space-y-2">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-sm font-semibold">版本 {note.version}</h3>
                    <span className="text-xs text-muted-foreground">{note.date}</span>
                  </div>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {note.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </ScrollArea>
        ) : null}

        <Separator />
        <DialogFooter className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onReplayTour()
                handleOpenChange(false)
              }}
            >
              <SparklesIcon aria-hidden="true" />
              重新播放新手引导
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onOpenFeedback()
                handleOpenChange(false)
              }}
            >
              <MessageSquareIcon aria-hidden="true" />
              反馈问题
            </Button>
          </div>
          <Button type="button" size="sm" onClick={() => handleOpenChange(false)}>
            知道了
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DemoActions({
  busy,
  onInstall,
  onRemove,
}: {
  busy: boolean
  onInstall: () => void | Promise<void>
  onRemove: () => void | Promise<void>
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3")}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">演示资料</p>
        <p className="text-xs text-muted-foreground">
          载入一套虚构的任务书、开题报告与中期检查，标题以「参考样例·」开头，随时可以清除。
        </p>
      </div>
      <Button type="button" size="sm" disabled={busy} onClick={() => void onInstall()}>
        <BookOpenIcon aria-hidden="true" />
        {busy ? "处理中…" : "载入演示资料"}
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void onRemove()}>
        <TrashIcon aria-hidden="true" />
        清除
      </Button>
    </div>
  )
}
