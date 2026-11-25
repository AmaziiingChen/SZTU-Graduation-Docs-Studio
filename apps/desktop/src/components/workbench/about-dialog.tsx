import { useEffect, useState } from "react"
import { InfoIcon, MessageSquareIcon } from "lucide-react"

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
import { Separator } from "@/components/ui/separator"
import type { AppInfo, SztuDesktopApi } from "@/types/desktop-api"

function desktopApi(): SztuDesktopApi | undefined {
  return (window as Window & { sztuDesktop?: SztuDesktopApi }).sztuDesktop
}

export function AboutDialog({
  open,
  onOpenChange,
  onOpenFeedback,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenFeedback: () => void
}) {
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const api = desktopApi()
    if (!api) return
    api
      .getAppInfo()
      .then((value) => {
        if (!cancelled) setInfo(value)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <InfoIcon aria-hidden="true" className="size-4" />
            关于与许可
          </DialogTitle>
          <DialogDescription>
            SZTU 文档工作台（SZTU Docs Studio）。本地优先的论文与过程材料排版工具。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 text-sm">
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">版本</span>
              <Badge variant="secondary">{info?.appVersion ?? "读取中…"}</Badge>
              {info?.electronVersion ? (
                <span className="text-xs text-muted-foreground">Electron {info.electronVersion}</span>
              ) : null}
              {info?.platform ? (
                <span className="text-xs text-muted-foreground">{info.platform}</span>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              文档与档案保存在本机，不上传云端；匿名使用统计、诊断包和应用内反馈分别由你确认或主动提交。
            </p>
          </div>

          <Separator />

          <div className="grid gap-1">
            <div className="font-medium">许可证</div>
            <p className="text-xs text-muted-foreground">
              本软件以 GNU 通用公共许可证第 3 版（GPL-3.0）发布。第三方组件与字体的许可清单随安装包提供，位于
              <code className="mx-1 rounded bg-muted px-1 py-0.5">third-party-licenses/</code>。
            </p>
          </div>

          <div className="grid gap-1">
            <div className="font-medium">隐私</div>
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              <li>文档正文、图片、参考文献只保存在本机；不注册账号、不同步云端。</li>
              <li>匿名使用统计包含版本、系统、操作结果与已保存的学院/专业，不包含姓名、学号、论文题目或文档正文。</li>
              <li>诊断包只有你点击发送时才会上传，云端保留 30 天；反馈中的联系方式仅用于回访。</li>
              <li>应用内反馈保存 180 天；不包含文档内容，除非你在提交时主动勾选附带诊断包。</li>
            </ul>
          </div>
        </div>

        <DialogFooter className="flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              onOpenChange(false)
              onOpenFeedback()
            }}
          >
            <MessageSquareIcon aria-hidden="true" />
            反馈问题
          </Button>
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            知道了
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
