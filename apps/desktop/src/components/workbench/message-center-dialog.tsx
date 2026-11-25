import { useEffect, useMemo, useState } from "react"
import { BellIcon, ChevronLeftIcon, MegaphoneIcon } from "lucide-react"

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
import type { NoticeAction, ReleaseNotice } from "@/types/desktop-api"

const severityLabel: Record<ReleaseNotice["severity"], string> = {
  info: "通知",
  important: "重要",
  critical: "紧急",
}

const severityClass: Record<ReleaseNotice["severity"], string> = {
  info: "bg-muted text-muted-foreground",
  important: "bg-accent text-accent-foreground",
  critical: "bg-destructive/10 text-destructive",
}

const formatDate = (value: string): string => {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return value
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(time))
}

const summaryOf = (body: string): string => {
  const singleLine = body.replace(/\s+/g, " ").trim()
  return singleLine.length > 88 ? `${singleLine.slice(0, 88)}…` : singleLine
}

export type MessageCenterDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  notices: ReleaseNotice[]
  readIds: string[]
  onMarkRead: (noticeId: string) => void
  onAction: (action: NoticeAction) => void
}

export function MessageCenterDialog({
  open,
  onOpenChange,
  notices,
  readIds,
  onMarkRead,
  onAction,
}: MessageCenterDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const read = useMemo(() => new Set(readIds), [readIds])
  const selected = notices.find((notice) => notice.id === selectedId) ?? null

  useEffect(() => {
    if (!open) setSelectedId(null)
  }, [open])

  const openNotice = (notice: ReleaseNotice) => {
    setSelectedId(notice.id)
    onMarkRead(notice.id)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(78vh,620px)] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-4 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <BellIcon className="size-4" aria-hidden="true" />
            消息通知
          </DialogTitle>
          <DialogDescription>
            来自维护者的通知与新功能说明。消息只在版本与时间范围内显示。
          </DialogDescription>
        </DialogHeader>

        {selected ? (
          <>
            <div className="border-b px-4 py-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 -translate-x-2 gap-1 px-2"
                onClick={() => setSelectedId(null)}
              >
                <ChevronLeftIcon className="size-4" aria-hidden="true" />
                全部消息
              </Button>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <article className="space-y-4 px-4 py-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={severityClass[selected.severity]} variant="secondary">
                    {severityLabel[selected.severity]}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(selected.startsAt)}
                  </span>
                </div>
                <h3 className="text-lg font-semibold leading-snug">{selected.title}</h3>
                {selected.imageUrl ? (
                  <img
                    src={selected.imageUrl}
                    alt={selected.title}
                    className="max-h-64 w-full rounded-md border object-cover"
                    loading="lazy"
                  />
                ) : null}
                <p className="whitespace-pre-wrap text-sm leading-7 text-foreground">
                  {selected.body}
                </p>
                {selected.actions.length > 0 ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {selected.actions.map((action) => (
                      <Button
                        key={action.id}
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onAction(action)}
                      >
                        {action.label}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </article>
            </ScrollArea>
          </>
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            {notices.length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <MegaphoneIcon className="size-6" aria-hidden="true" />
                暂时没有新消息。
              </div>
            ) : (
              <ul className="divide-y">
                {notices.map((notice) => {
                  const unread = !read.has(notice.id)
                  return (
                    <li key={notice.id}>
                      <Button
                        type="button"
                        variant="ghost"
                        className="flex h-auto w-full items-start gap-3 rounded-none px-4 py-4 text-left whitespace-normal"
                        onClick={() => openNotice(notice)}
                      >
                        <span
                          className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                          style={{ visibility: unread ? "visible" : "hidden" }}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 space-y-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">{notice.title}</span>
                            <Badge className={severityClass[notice.severity]} variant="secondary">
                              {severityLabel[notice.severity]}
                            </Badge>
                          </span>
                          <span className="line-clamp-2 block text-xs leading-5 font-normal text-muted-foreground">
                            {summaryOf(notice.body)}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatDate(notice.startsAt)}
                        </span>
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </ScrollArea>
        )}

        <DialogFooter className="mx-0 mb-0 rounded-none border-t bg-muted/40 px-4 py-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
