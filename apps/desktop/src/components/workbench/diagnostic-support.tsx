import { FolderCodeIcon } from "@/components/ui/folder-code"
import { AnimatedActionIcon } from "@/components/animated-action-icon"
import { useState } from "react"
import { LoaderCircleIcon } from "lucide-react"

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
import type { FullDiagnosticCase, SztuDesktopApi } from "@/types/desktop-api"

function desktopApi(): SztuDesktopApi | undefined {
  return (window as Window & { sztuDesktop?: SztuDesktopApi }).sztuDesktop
}

function readableBytes(value: number): string {
  if (value < 1024) return `${value} B`
  return `${(value / 1024).toFixed(1)} KB`
}

export function DiagnosticSupport({ caseId, showSummary = false }: { caseId?: string; showSummary?: boolean }) {
  const [fullOpen, setFullOpen] = useState(false)
  const [fullCase, setFullCase] = useState<FullDiagnosticCase | null>(null)
  const [pending, setPending] = useState<"prepare" | "save" | "send" | null>(null)
  const [message, setMessage] = useState("")
  const [sent, setSent] = useState(false)

  const prepare = async () => {
    setFullOpen(true)
    setFullCase(null)
    setMessage("")
    setSent(false)
    setPending("prepare")
    try {
      const api = desktopApi()
      if (!api) throw new Error("请在桌面应用中创建诊断包。")
      setFullCase(await api.prepareDiagnosticReport(caseId))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "诊断包创建失败，请重试。")
    } finally {
      setPending(null)
    }
  }

  const handlePackage = async (action: "save" | "send") => {
    const api = desktopApi()
    if (!api || !fullCase || pending) return
    setPending(action)
    setMessage("")
    try {
      if (action === "save") {
        const result = await api.saveDiagnosticReport(fullCase.reportId)
        if (result.saved) setMessage("已保存到你选择的位置。")
      } else {
        const receipt = await api.sendDiagnosticReport(fullCase.reportId)
        setSent(true)
        setMessage(`已提交给软件维护者。诊断包编号 ${receipt.reportId}`)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "诊断包操作失败。")
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="grid gap-3">
      {showSummary ? (
        <div className="grid gap-1">
          <p className="text-xs text-muted-foreground">
            正式版默认发送匿名使用统计，用于故障分析和版本改进：包括版本、系统、操作结果及已保存的学院和专业，不包含姓名、学号、论文题目或文档正文。网络不可用时不影响编辑和导出。诊断包仅在你确认发送后上传。
          </p>
          <div className="text-sm font-medium">故障诊断包</div>
        </div>
      ) : null}
      <Button variant="outline" className="w-fit" onClick={() => void prepare()}>
        <AnimatedActionIcon icon={FolderCodeIcon} />
        创建诊断包
      </Button>
      <Dialog open={fullOpen} onOpenChange={open => { if (!pending) setFullOpen(open) }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>诊断包</DialogTitle>
            <DialogDescription>
              诊断包在本机最多保留 48 小时。发送后，软件维护者可查看本次操作的原始正文、档案、素材、运行日志和文件路径，用于排查故障。云端保留 30 天。
            </DialogDescription>
          </DialogHeader>
          {pending === "prepare" ? (
            <p role="status" className="flex items-center gap-2 text-sm">
              <LoaderCircleIcon className="size-4 animate-spin" /> 正在准备诊断包
            </p>
          ) : null}
          {fullCase ? (
            <div className="grid gap-2 text-sm">
              <p>{fullCase.operation === "diagnostic.prepare" ? "当前运行现场" : fullCase.operation} · {new Date(fullCase.createdAt * 1000).toLocaleString()} · {readableBytes(fullCase.sizeBytes)}</p>
              <ul aria-label="将提交的文件" className="max-h-48 overflow-auto rounded-md border p-2">
                {fullCase.files.map(file => <li key={file.name} className="break-all">{file.name} · {readableBytes(file.sizeBytes)}</li>)}
              </ul>
              {fullCase.missing.length ? (
                <Alert>
                  <AlertTitle>部分材料未保存</AlertTitle>
                  <AlertDescription className="max-h-28 overflow-auto break-all">{fullCase.missing.join("、")}</AlertDescription>
                </Alert>
              ) : null}
              {fullCase.excluded?.length ? (
                <p className="text-muted-foreground">未包含 {fullCase.excluded.join("；")}。</p>
              ) : null}
              {fullCase.sizeBytes > fullCase.uploadLimitBytes ? (
                <p>此包超过 {readableBytes(fullCase.uploadLimitBytes)} 的上传上限，可保存后交给维护者。</p>
              ) : null}
            </div>
          ) : null}
          {message ? <p role="status" className="break-all text-sm">{message}</p> : null}
          <DialogFooter>
            <Button variant="outline" disabled={Boolean(pending)} onClick={() => setFullOpen(false)}>关闭</Button>
            <Button variant="outline" disabled={Boolean(pending) || !fullCase} onClick={() => void handlePackage("save")}>保存到本机</Button>
            <Button disabled={Boolean(pending) || sent || !fullCase || fullCase.sizeBytes > fullCase.uploadLimitBytes}
              onClick={() => void handlePackage("send")}>发送诊断包</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
