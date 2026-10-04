import { useActionFeedback } from "@/hooks/use-action-feedback"
import { ActionFeedbackIcon } from "@/components/workbench/action-feedback-icon"
import { CopyIcon } from "@/components/ui/copy"
import { DownloadIcon } from "@/components/ui/download"
import { writeClipboardText } from "@/lib/desktop-clipboard"
import { toast } from "sonner"
import { AnimatedActionIcon } from "@/components/animated-action-icon"
import { FileTextIcon } from "@/components/ui/file-text"


import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"

export function LatexSourceSheet({
  latex,
  filename,
  packages = [],
}: {
  latex: string
  filename: string
  packages?: string[]
}) {
  const { completed, complete, reset } = useActionFeedback()
  const copyLatex = async () => {
    reset("copyLatex")
    if (!latex) return
    try {
      await writeClipboardText(latex)
      complete("copyLatex")
      toast.success("LaTeX 源码已复制。")
    } catch {
      toast.error("无法访问剪贴板，请在“查看 LaTeX”中手动复制。")
    }
  }
  const downloadLatex = () => {
    reset("downloadLatex")
    if (!latex) return
    const url = URL.createObjectURL(new Blob([latex], { type: "text/plain;charset=utf-8" }))
    try {
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = filename
      anchor.click()
      complete("downloadLatex")
      toast.success("文件已准备好，已请求下载。")
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  return (
    <>
    <Sheet>
      <SheetTrigger render={<Button type="button" size="sm" variant="outline" disabled={!latex} />}>
        <AnimatedActionIcon icon={FileTextIcon} />
        查看 LaTeX
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>LaTeX 源码</SheetTitle>
          <SheetDescription>
            {packages.length > 0
              ? `导言区需要加载：${packages.map((item) => `\\usepackage{${item}}`).join("、")}`
              : "可直接复制到论文正文。"}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 px-4 pb-4">
          <Textarea
            aria-label="生成的 LaTeX 源码"
            readOnly
            value={latex}
            className="h-full min-h-72 resize-none text-xs"
          />
        </div>
      </SheetContent>
    </Sheet>
    <Button type="button" size="sm" variant="outline" disabled={!latex} onClick={() => void copyLatex()}>
      <ActionFeedbackIcon token={completed.copyLatex}><AnimatedActionIcon icon={CopyIcon} /></ActionFeedbackIcon>
      复制源码
    </Button>
    <Button type="button" size="sm" disabled={!latex} onClick={downloadLatex}>
      <ActionFeedbackIcon token={completed.downloadLatex}><AnimatedActionIcon icon={DownloadIcon} /></ActionFeedbackIcon>
      下载源码
    </Button>
    </>
  )
}
