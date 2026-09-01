import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"

export type DocumentSectionState = "complete" | "incomplete" | "error"

export type DocumentSectionOption = {
  id: string
  label: string
  description: string
  state?: DocumentSectionState
}

type DocumentSectionNavProps = {
  sections: DocumentSectionOption[]
  activeSection: string
  onSectionChange: (sectionId: string) => void
}

function stateLabel(state: DocumentSectionState | undefined) {
  if (state === "complete") return "已填写"
  if (state === "error") return "需修改"
  return "未完成"
}

export function DocumentSectionNav({
  sections,
  activeSection,
  onSectionChange,
}: DocumentSectionNavProps) {
  return (
    <div
      data-slot="document-section-nav"
      className="flex h-full min-h-0 w-48 shrink-0 flex-col border-r bg-muted/30"
    >
      <div
        data-slot="document-section-header"
        className="flex h-(--header-height) shrink-0 items-center border-b px-4"
      >
        <p className="text-sm font-medium">文档板块</p>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <nav className="grid gap-1 p-2" aria-label="当前文档板块">
          {sections.map((section) => {
            const selected = section.id === activeSection
            const state = section.state ?? "incomplete"
            return (
              <Button
                key={section.id}
                type="button"
                variant={selected ? "secondary" : "ghost"}
                className="h-auto w-full justify-start px-3 py-2 text-left whitespace-normal"
                aria-current={selected ? "page" : undefined}
                onClick={() => onSectionChange(section.id)}
              >
                <span className="min-w-0 flex-1">{section.label}</span>
                <Badge
                  variant={state === "error" ? "destructive" : "outline"}
                  className="ml-2"
                >
                  {stateLabel(state)}
                </Badge>
              </Button>
            )
          })}
        </nav>
      </ScrollArea>
    </div>
  )
}
