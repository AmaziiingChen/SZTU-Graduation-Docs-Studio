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
            关于
          </DialogTitle>
          <DialogDescription>
            SZTU 文档工作台（SZTU Docs Studio）——本地优先的论文与过程材料排版工具。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{info?.appVersion ?? "读取中…"}</Badge>
            <span className="text-xs text-muted-foreground">
              Electron {info?.electronVersion ?? "…"} · {info?.platform ?? "…"}
            </span>
          </div>

          <Separator />

          <section className="grid gap-1.5" aria-labelledby="about-privacy">
            <h3 id="about-privacy" className="text-sm font-medium">
              数据与隐私
            </h3>
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              <li>文档、图片与参考文献只保存在本机，不注册账号、不同步云端。</li>
              <li>匿名使用统计不含姓名、学号、论文题目或文档正文；诊断包只有你点击发送时才会上传。</li>
              <li>反馈保存 180 天，诊断包保留 30 天；联系方式只用于回访。</li>
            </ul>
          </section>

          <section className="grid gap-1" aria-labelledby="about-license">
            <h3 id="about-license" className="text-sm font-medium">
              许可证
            </h3>
            <p className="text-xs text-muted-foreground">
              本软件以 GNU 通用公共许可证第 3 版（GPL-3.0）发布；完整许可文本、第三方组件与字体清单随安装包提供，
              位于{" "}
              <code className="rounded bg-muted px-1 py-0.5">third-party-licenses/</code>。
            </p>
          </section>
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
