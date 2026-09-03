import { CodeXmlIcon } from "lucide-react"

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
  packages = [],
}: {
  latex: string
  packages?: string[]
}) {
  return (
    <Sheet>
      <SheetTrigger render={<Button type="button" size="sm" variant="outline" disabled={!latex} />}>
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
      </SheetContent>
    </Sheet>
  )
}
