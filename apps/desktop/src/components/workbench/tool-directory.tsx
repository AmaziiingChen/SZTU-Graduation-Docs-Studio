import { ExternalLinkIcon } from "@/components/ui/external-link"
import { AnimatedActionIcon } from "@/components/animated-action-icon"
import { useState } from "react"
import { LoaderCircleIcon } from "lucide-react"

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
import { cn } from "@/lib/utils"

export function ToolDirectory({
  onOpenTool,
  disabled = false,
}: {
  onOpenTool: (toolId: ToolLinkId) => void | Promise<void>
  disabled?: boolean
}) {
  const [openingToolId, setOpeningToolId] = useState<ToolLinkId | null>(null)

  const openTool = async (toolId: ToolLinkId) => {
    if (disabled || openingToolId !== null) return
    setOpeningToolId(toolId)
    try {
      await onOpenTool(toolId)
    } finally {
      setOpeningToolId(null)
    }
  }

  return (
    <ScrollArea className="h-full">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-5 lg:px-8">
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
                {items.map((item) => {
                  const isOpening = openingToolId === item.id
                  return (
                    <Card
                      key={item.id}
                      size="sm"
                    >
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
                            aria-label={isOpening ? `正在打开 ${item.name}` : `打开 ${item.name}`}
                            title={isOpening ? `正在打开 ${item.name}` : `打开 ${item.name}`}
                            disabled={disabled || openingToolId !== null}
                            className="group/tool-open"
                            onClick={() => void openTool(item.id)}
                          >
                            <span
                              data-slot="tool-open-icon"
                              data-state={isOpening ? "opening" : "idle"}
                              className="inline-grid size-4 place-items-center"
                            >
                              <AnimatedActionIcon
                                icon={ExternalLinkIcon}
                                className={cn(
                                  "col-start-1 row-start-1",
                                  isOpening ? "invisible" : "visible",
                                )}
                              />
                              <LoaderCircleIcon
                                className={cn(
                                  "col-start-1 row-start-1 transition-[transform,opacity,filter] duration-[250ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                                  isOpening
                                    ? "animate-spin scale-100 opacity-100 blur-none motion-reduce:animate-none"
                                    : "scale-75 opacity-0 blur-[2px]",
                                )}
                              />
                            </span>
                          </Button>
                        </div>
                      </CardHeader>
                    </Card>
                  )
                })}
              </div>
            </section>
          )
        })}
      </main>
    </ScrollArea>
  )
}
