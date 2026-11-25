import { useState } from "react"
import { BookOpenIcon, FolderDownIcon, SparklesIcon, Trash2Icon } from "lucide-react"

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
import { Separator } from "@/components/ui/separator"

const STEPS = [
  {
    title: "第一步：填写基本信息",
    body: "左侧「基本信息」里的姓名、学号、学院、专业只需填一次，之后所有文档都会带上这些信息；论文题目、指导教师也可以随时修改。",
  },
  {
    title: "第二步：新建文档并写作",
    body: "在「文档」里新建任务书、开题报告或中期检查。正文按章节填写，右侧可以随时检查内容是否齐全；保存会自动进行。毕业论文可以先下载学校模板，再按模板排版。",
  },
  {
    title: "第三步：处理参考文献",
    body: "任务书和开题报告的参考文献可以直接粘贴 BibTeX。如果某条文献有空字段或格式错误，编辑框会当场指出，不需要等到导出才发现。",
  },
  {
    title: "第四步：预览与导出",
    body: "点「预览」确认版式，再选择导出 Word 或 PDF。论文的排版工具可以下载学校模板、检查字体，导出的文件会保存在你选择的文件夹里。",
  },
]

export type UsageGuideDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  sampleBusy: boolean
  onInstallSample: () => Promise<void>
  onRemoveSample: () => Promise<void>
}

export function UsageGuideDialog({
  open,
  onOpenChange,
  sampleBusy,
  onInstallSample,
  onRemoveSample,
}: UsageGuideDialogProps) {
  const [confirmRemove, setConfirmRemove] = useState(false)

  const install = async () => {
    await onInstallSample()
    setConfirmRemove(false)
  }
  const remove = async () => {
    await onRemoveSample()
    setConfirmRemove(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setConfirmRemove(false)
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-2xl" showCloseButton>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpenIcon className="size-5" aria-hidden="true" />
            使用说明
          </DialogTitle>
          <DialogDescription>
            四步完成一份过程文档。想先看看成品，可以载入一套虚构的演示资料（示例学生档案与七类文档），看完随时清除。
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-3">
          <ol className="grid gap-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="rounded-lg border bg-muted/30 p-3">
                <p className="text-sm font-medium">
                  {index + 1}. {step.title}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
          <Separator className="my-4" />
          <div className="grid gap-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <SparklesIcon className="size-4" aria-hidden="true" />
              演示资料
            </p>
            <p className="text-sm text-muted-foreground">
              载入后会新增标题以「参考样例·」开头的文档，覆盖任务书、开题报告、中期检查与四类评审表；不会改动你自己已有的文档。论文样例的结构保留在数据里，正文编辑开放后自动出现。
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" disabled={sampleBusy} onClick={() => void install()}>
                <FolderDownIcon className="size-4" aria-hidden="true" />
                载入演示资料
              </Button>
              {confirmRemove ? (
                <>
                  <Button type="button" variant="destructive" disabled={sampleBusy} onClick={() => void remove()}>
                    确认清除
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setConfirmRemove(false)}>
                    取消
                  </Button>
                </>
              ) : (
                <Button type="button" variant="outline" disabled={sampleBusy} onClick={() => setConfirmRemove(true)}>
                  <Trash2Icon className="size-4" aria-hidden="true" />
                  清除演示资料
                </Button>
              )}
            </div>
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            知道了
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
