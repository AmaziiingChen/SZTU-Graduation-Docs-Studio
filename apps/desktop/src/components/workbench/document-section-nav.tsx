import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { SectionCompletionMark } from "@/components/workbench/section-completion-mark"

export type DocumentSectionState =
  | "complete"
  | "incomplete"
  | "optional"
  | "error"

export type DocumentSectionOption = {
  id: string
  label: string
  description: string
  state?: DocumentSectionState
}

type DocumentSectionNavProps = {
  sections: DocumentSectionOption[]
  activeSection: string
  animationContextKey: string
  showCompletion?: boolean
  showSidebarToggle?: boolean
  onSectionChange: (sectionId: string) => void
}

export function DocumentSectionNav({
  sections,
  activeSection,
  animationContextKey,
  showCompletion = true,
  showSidebarToggle = false,
  onSectionChange,
}: DocumentSectionNavProps) {
  return (
    <div
      data-slot="document-section-nav"
      data-tour="section-list"
      className="flex h-full min-h-0 w-40 shrink-0 flex-col border-r bg-muted/30"
    >
      <div
        data-slot="document-section-header"
        className="flex h-(--header-height) shrink-0 items-center border-b px-4"
      >
        {showSidebarToggle ? <SidebarTrigger className="-ml-1" /> : null}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <nav className="grid gap-1 p-2" aria-label="当前文档板块">
          {sections.map((section) => {
            const selected = section.id === activeSection
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
                {showCompletion && section.state ? (
                  <SectionCompletionMark
                    key={`${animationContextKey}:${section.id}`}
                    state={section.state}
                  />
                ) : null}
              </Button>
            )
          })}
        </nav>
      </ScrollArea>
    </div>
  )
}
