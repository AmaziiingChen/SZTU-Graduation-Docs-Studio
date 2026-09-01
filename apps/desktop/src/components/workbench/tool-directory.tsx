import { ExternalLinkIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  TOOL_CATEGORY_ORDER,
  TOOL_DIRECTORY,
  type ToolLinkId,
} from "@/data/tool-directory"

export function ToolDirectory({
  onOpenTool,
  disabled = false,
}: {
  onOpenTool: (toolId: ToolLinkId) => void
  disabled?: boolean
}) {
  return (
    <ScrollArea className="h-full">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8 lg:px-8">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight">论文工具台</h2>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            集中打开毕业论文写作常用的网站、应用和浏览器扩展。外部工具仅作为效率参考，使用前请自行核对内容与数据政策。
          </p>
        </div>

        {TOOL_CATEGORY_ORDER.map((category) => {
          const items = TOOL_DIRECTORY.filter((item) => item.category === category)
          return (
            <section key={category} aria-labelledby={`tool-category-${category}`}>
              <div className="mb-3 flex items-center gap-2">
                <h3 id={`tool-category-${category}`} className="text-base font-medium">
                  {category}
                </h3>
                <Badge variant="secondary">{items.length}</Badge>
              </div>
              <div className="grid grid-cols-1 gap-3 @3xl/main:grid-cols-2 @6xl/main:grid-cols-3">
                {items.map((item) => (
                  <Card key={item.id} size="sm" className="min-h-28">
                    <CardHeader className="grid-cols-[auto_1fr_auto] items-center gap-x-3">
                      <div className="flex size-10 items-center justify-center overflow-hidden rounded-lg bg-muted p-1.5">
                        <img
                          src={item.icon}
                          alt=""
                          className="size-full object-contain"
                          loading="lazy"
                        />
                      </div>
                      <div className="min-w-0 space-y-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <CardTitle className="truncate">{item.name}</CardTitle>
                          <Badge variant="outline" className="shrink-0 font-normal">
                            {item.kind}
                          </Badge>
                        </div>
                        <CardDescription className="line-clamp-2 leading-5">
                          {item.description}
                        </CardDescription>
                      </div>
                      <div className="self-center">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`打开 ${item.name}`}
                          title={`打开 ${item.name}`}
                          disabled={disabled}
                          onClick={() => onOpenTool(item.id)}
                        >
                          <ExternalLinkIcon />
                        </Button>
                      </div>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            </section>
          )
        })}
      </main>
    </ScrollArea>
  )
}
