import { useState } from "react"
import {
  CheckCircle2Icon,
  FileJsonIcon,
  LoaderCircleIcon,
  SendIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react"

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
  | { status: "ready"; summary: DiagnosticSummary; saved: boolean }
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

  const prepare = async () => {
    const api = desktopApi()
    if (!api) {
      setState({ status: "error", message: "请在 Electron 桌面应用中创建诊断包。" })
      return
    }
    setState({ status: "preparing" })
    try {
      const summary = await api.prepareDiagnosticReport()
      setState({ status: "ready", summary, saved: false })
      setDialogOpen(true)
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "诊断包创建失败，请重试。",
      })
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
          收集版本、运行环境和结构化操作结果，不包含正文、姓名、学号、文件名或完整路径。
        </p>
      </div>
      {state.status === "error" ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>无法创建诊断包</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
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
            <FileJsonIcon />
          )}
          {state.status === "preparing" ? "正在检查隐私" : "创建诊断包"}
        </Button>
        <Button
          variant="outline"
          disabled
          title="后端留存、访问审计和自动删除机制验证后开放"
        >
          <SendIcon />
          发送诊断包
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        远程发送将在后端留存、访问审计和自动删除机制验证后开放。
      </p>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>诊断包已通过隐私扫描</DialogTitle>
            <DialogDescription>
              请确认摘要后保存到本机。诊断包将在十分钟后失效，需要时可重新创建。
            </DialogDescription>
          </DialogHeader>
          {state.status === "ready" ? (
            <div className="grid gap-3">
              <Alert>
                <ShieldCheckIcon />
                <AlertTitle>未发现敏感内容</AlertTitle>
                <AlertDescription>
                  已移除 {state.summary.sourceFieldsRemoved} 个原始说明或扩展字段。
                </AlertDescription>
              </Alert>
              <div className="grid gap-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">运行环境检查</span>
                  <span>{state.summary.environmentCheckCount} 项</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">结构化操作记录</span>
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
                  <CheckCircle2Icon className="size-4" />
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
              {saving ? <LoaderCircleIcon className="animate-spin" /> : <FileJsonIcon />}
              {saving ? "正在保存" : "保存到本机"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
