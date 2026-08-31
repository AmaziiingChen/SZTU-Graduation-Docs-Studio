import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

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
  compact?: boolean
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
  compact = false,
}: DocumentSectionNavProps) {
  const active = sections.find((section) => section.id === activeSection)

  if (compact) {
    return (
      <div className="grid gap-1 border-b p-3">
        <p className="text-xs font-medium text-muted-foreground">当前板块</p>
        <Select
          value={activeSection}
          onValueChange={(value) => {
            if (value !== null) onSectionChange(value)
          }}
        >
          <SelectTrigger className="w-full" aria-label="选择文档板块">
            <SelectValue>{active?.label ?? "选择板块"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {sections.map((section) => (
              <SelectItem key={section.id} value={section.id}>
                {section.label} · {stateLabel(section.state)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-r bg-muted/30">
      <div className="border-b p-4">
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
