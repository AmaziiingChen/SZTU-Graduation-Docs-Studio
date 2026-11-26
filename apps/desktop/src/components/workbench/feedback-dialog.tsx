import { useState } from "react"
import { LoaderCircleIcon, SendIcon } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
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
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { isValidContact } from "@/lib/contact-validation"
import type { FeedbackCategory, SztuDesktopApi } from "@/types/desktop-api"

const CATEGORIES: { id: FeedbackCategory; label: string }[] = [
  { id: "bug", label: "遇到问题" },
  { id: "suggestion", label: "功能建议" },
  { id: "other", label: "其他" },
]

export type FeedbackDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  diagnosticReportId?: string
  onSubmitted?: (receiptId: string) => void
}

function desktopApi(): SztuDesktopApi | undefined {
  return (window as Window & { sztuDesktop?: SztuDesktopApi }).sztuDesktop
}

export function FeedbackDialog({ open, onOpenChange, diagnosticReportId, onSubmitted }: FeedbackDialogProps) {
  const [category, setCategory] = useState<FeedbackCategory>("bug")
  const [message, setMessage] = useState("")
  const [contact, setContact] = useState("")
  const [attachDiagnostics, setAttachDiagnostics] = useState(false)
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")
  const [receipt, setReceipt] = useState("")

  const reset = () => {
    setCategory("bug")
    setMessage("")
    setContact("")
    setAttachDiagnostics(false)
    setStatus("")
    setError("")
    setReceipt("")
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (pending) return
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  const submit = async () => {
    const api = desktopApi()
    if (!api) {
      setError("请在桌面应用中提交反馈。")
      return
    }
    setPending(true)
    setError("")
    setReceipt("")
    try {
      let attachedCaseId: string | undefined
      if (attachDiagnostics) {
        setStatus("正在准备诊断包…")
        const prepared = diagnosticReportId
          ? await api.prepareDiagnosticReport(diagnosticReportId)
          : await api.prepareDiagnosticReport()
        setStatus("正在上传诊断包…")
        await api.sendDiagnosticReport(prepared.reportId)
        attachedCaseId = prepared.reportId
      }
      setStatus("正在提交反馈…")
      const result = await api.submitFeedback({
        category,
        message: message.trim(),
        contact: contact.trim(),
        ...(attachedCaseId ? { diagnosticReportId: attachedCaseId } : {}),
      })
      setStatus("")
      setReceipt(result.receiptId)
      onSubmitted?.(result.receiptId)
    } catch (submitError) {
      setStatus("")
      setError(submitError instanceof Error ? submitError.message : "反馈提交失败，请稍后再试。")
    } finally {
      setPending(false)
    }
  }

  const contactValid = isValidContact(contact)
  const contactInvalid = contact.trim().length > 0 && !contactValid
  const canSubmit = message.trim().length >= 10 && contactValid && !pending

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>反馈问题</DialogTitle>
          <DialogDescription>
            反馈会直接发送给软件维护者。请留下邮箱或手机号，方便我们回访；不会自动附带你的文档内容。
          </DialogDescription>
        </DialogHeader>

        {receipt ? (
          <div className="grid gap-3 text-sm">
            <p className="font-medium">反馈已提交</p>
            <p className="break-all text-muted-foreground">反馈编号 {receipt}</p>
            <p>维护者可能会通过你留下的联系方式回访。也可以把编号记下来，后续沟通时直接说明。</p>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <span className="text-sm font-medium">反馈类型</span>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((item) => (
                  <Button
                    key={item.id}
                    type="button"
                    size="sm"
                    variant={category === item.id ? "secondary" : "outline"}
                    aria-pressed={category === item.id}
                    onClick={() => setCategory(item.id)}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="feedback-message">具体描述</Label>
              <Textarea
                id="feedback-message"
                rows={6}
                maxLength={2000}
                placeholder="你在做什么时遇到了什么问题？如果方便，写上使用的文档类型和出错时的提示。"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">至少 10 个字，不要粘贴身份证号等敏感信息。</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="feedback-contact">联系方式</Label>
              <Input
                id="feedback-contact"
                placeholder="邮箱或手机号，便于回访"
                value={contact}
                aria-invalid={contactInvalid}
                aria-describedby="feedback-contact-hint"
                onChange={(event) => setContact(event.target.value)}
              />
              <p
                id="feedback-contact-hint"
                className={contactInvalid ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
              >
                {contactInvalid
                  ? "请填写有效的邮箱或手机号。"
                  : "只用于回访，不会公开；手机号可写 13800138000 或 +86 138 0013 8000。"}
              </p>
            </div>

            <div className="grid gap-2 rounded-md border p-3">
              <div className="flex items-start gap-2">
                <input
                  id="feedback-attach-diagnostics"
                  type="checkbox"
                  className="mt-0.5 size-4"
                  checked={attachDiagnostics}
                  onChange={(event) => setAttachDiagnostics(event.target.checked)}
                />
                <Label htmlFor="feedback-attach-diagnostics" className="text-sm font-medium">
                  附带诊断包，帮助定位问题
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">
                诊断包包含出错时的运行日志、环境信息和那一次操作的文档内容（正文、图片、参考文献），只在勾选时上传，云端保留 30 天。
              </p>
            </div>

            <p className="text-xs text-muted-foreground">
              将发送：反馈内容、联系方式、应用版本与系统类型{attachDiagnostics ? "、诊断包" : ""}。
            </p>

            {status ? (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
                {status}
              </p>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {receipt ? (
            <Button type="button" onClick={() => handleOpenChange(false)}>关闭</Button>
          ) : (
            <>
              <Button type="button" variant="outline" disabled={pending} onClick={() => handleOpenChange(false)}>
                取消
              </Button>
              <Button type="button" disabled={!canSubmit} onClick={() => void submit()}>
                {pending ? <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" /> : <SendIcon className="size-4" aria-hidden="true" />}
                提交反馈
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
