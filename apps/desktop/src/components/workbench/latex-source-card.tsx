import { CopyIcon, DownloadIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { writeClipboardText } from "@/lib/desktop-clipboard"

export function LatexSourceCard({
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
      await writeClipboardText(latex)
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
    <Card>
      <CardHeader className="sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle>LaTeX 源码</CardTitle>
          <CardDescription>
            {packages.length > 0
              ? `导言区需要加载：${packages.map((item) => `\\usepackage{${item}}`).join("、")}`
              : "可直接复制到论文正文。"}
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={!latex} onClick={() => void copyLatex()}>
            <CopyIcon />
            复制 LaTeX
          </Button>
          <Button type="button" disabled={!latex} onClick={downloadLatex}>
            <DownloadIcon />
            下载 .tex
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Textarea
          aria-label="生成的 LaTeX 源码"
          readOnly
          value={latex}
          placeholder="输入内容通过检查后生成源码。"
          className="min-h-64 resize-y font-mono text-xs"
        />
      </CardContent>
    </Card>
  )
}
