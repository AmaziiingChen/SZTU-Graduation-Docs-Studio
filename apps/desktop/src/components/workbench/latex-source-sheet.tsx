import { CodeXmlIcon, CopyIcon, DownloadIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
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
  const copyLatex = async () => {
    if (!latex) return
    try {
      await navigator.clipboard.writeText(latex)
      toast.success("LaTeX 源码已复制。")
    } catch {
      toast.error("无法访问剪贴板，请手动选择并复制源码。")
    }
  }

  const downloadLatex = () => {
    if (!latex) return
    const blob = new Blob([latex], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Sheet>
      <SheetTrigger render={<Button type="button" variant="outline" disabled={!latex} />}>
        <CodeXmlIcon />
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
        <div className="min-h-0 flex-1 px-4">
          <Textarea
            aria-label="生成的 LaTeX 源码"
            readOnly
            value={latex}
            className="h-full min-h-72 resize-none text-xs"
          />
        </div>
        <SheetFooter className="flex-row justify-end border-t">
          <Button type="button" variant="outline" disabled={!latex} onClick={() => void copyLatex()}>
            <CopyIcon />
            复制 LaTeX
          </Button>
          <Button type="button" disabled={!latex} onClick={downloadLatex}>
            <DownloadIcon />
            下载 .tex
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
