import { DownloadIcon } from "@/components/ui/download"
import { CircleCheckIcon } from "@/components/ui/circle-check"
import { SendIcon } from "@/components/ui/send"
import { FolderCodeIcon } from "@/components/ui/folder-code"
import { AnimatedActionIcon } from "@/components/animated-action-icon"
import { useState } from "react"
import { LoaderCircleIcon, TriangleAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import type { DiagnosticSummary, SztuDesktopApi } from "@/types/desktop-api"

type DiagnosticState =
  | { status: "idle" }
  | { status: "preparing" }
  | { status: "ready"; summary: DiagnosticSummary; saved: boolean; sent: boolean }
  | { status: "error"; message: string }

function desktopApi(): SztuDesktopApi | undefined {
  return (window as Window & { sztuDesktop?: SztuDesktopApi }).sztuDesktop
}

function readableBytes(value: number): string {
  if (value < 1024) return `${value} B`
  return `${(value / 1024).toFixed(1)} KB`
}

export function DiagnosticSupport() {
  const [state, setState] = useState<DiagnosticState>({ status: "idle" })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)

  const prepare = async () => {
    const api = desktopApi()
    if (!api) {
      setState({ status: "error", message: "请在桌面应用中创建诊断包。" })
      return
    }
    setState({ status: "preparing" })
    try {
      const summary = await api.prepareDiagnosticReport()
      setState({ status: "ready", summary, saved: false, sent: false })
      setDialogOpen(true)
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "诊断包创建失败，请重试。",
      })
    }
  }

  const send = async (summary?: DiagnosticSummary) => {
    const api = desktopApi()
    if (!api) return
    setSending(true)
    try {
      const prepared = summary ?? (state.status === "ready" ? state.summary : undefined)
      const nextSummary = prepared ?? (await api.prepareDiagnosticReport())
      await api.sendDiagnosticReport(nextSummary.reportId)
      const saved = state.status === "ready" && state.summary.reportId === nextSummary.reportId
        ? state.saved
        : false
      setState({ status: "ready", summary: nextSummary, saved, sent: true })
      setDialogOpen(false)
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "诊断包发送失败，请重试。",
      })
      setDialogOpen(false)
    } finally {
      setSending(false)
    }
  }

  const save = async () => {
    if (state.status !== "ready") return
    const api = desktopApi()
    if (!api) return
    setSaving(true)
    try {
      const result = await api.saveDiagnosticReport(state.summary.reportId)
      if (result.saved) setState({ ...state, saved: true })
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "诊断包保存失败，请重试。",
      })
      setDialogOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <div className="text-sm font-medium">故障诊断包</div>
        <p className="text-xs text-muted-foreground">
          诊断包用于故障排查，不含姓名、学号、班级、文档正文及文件路径。
        </p>
      </div>
      {state.status === "error" ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle className="text-sm font-medium">诊断操作失败</AlertTitle>
          <AlertDescription className="text-xs">{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => void prepare()}
          disabled={state.status === "preparing"}
        >
          {state.status === "preparing" ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : (
            <AnimatedActionIcon icon={FolderCodeIcon} />
          )}
          {state.status === "preparing" ? "正在生成" : "创建诊断包"}
        </Button>
        <Button
          variant="outline"
          onClick={() => void send()}
          disabled={state.status === "preparing" || sending}
        >
          {sending ? <LoaderCircleIcon className="animate-spin" /> : <AnimatedActionIcon icon={SendIcon} />}
          {sending ? "正在发送" : "发送诊断包"}
        </Button>
      </div>
      {state.status === "ready" && state.sent ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AnimatedActionIcon icon={CircleCheckIcon} playOnMount />
          诊断包已发送，将在 30 天后自动删除。
        </div>
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>诊断包已生成</DialogTitle>
            <DialogDescription className="text-xs">
              包含应用版本、运行环境、操作记录及文档结构统计，不含文档正文。
            </DialogDescription>
          </DialogHeader>
          {state.status === "ready" ? (
            <div className="grid gap-3">
              <div className="grid gap-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">运行环境检查</span>
                  <span>{state.summary.environmentCheckCount} 项</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">操作记录</span>
                  <span>{state.summary.operationCount} 条</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">诊断包大小</span>
                  <span>{readableBytes(state.summary.sizeBytes)}</span>
                </div>
              </div>
              {state.saved ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <AnimatedActionIcon icon={CircleCheckIcon} playOnMount />
                  已保存到你选择的位置。
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              关闭
            </Button>
            <Button onClick={() => void save()} disabled={saving || state.status !== "ready"}>
              {saving ? <LoaderCircleIcon className="animate-spin" /> : <AnimatedActionIcon icon={DownloadIcon} />}
              {saving ? "正在保存" : "保存到本机"}
            </Button>
            <Button
              onClick={() => void send()}
              disabled={sending || state.status !== "ready"}
            >
              {sending ? <LoaderCircleIcon className="animate-spin" /> : <AnimatedActionIcon icon={SendIcon} />}
              {sending ? "正在发送" : "发送诊断包"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
