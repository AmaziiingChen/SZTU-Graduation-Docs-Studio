import type { ReactNode } from "react"
import { useSortable } from "@dnd-kit/react/sortable"
import { AnimatedActionIcon } from "@/components/animated-action-icon"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { GripVerticalIcon } from "@/components/ui/grip-vertical"
import { ArrowUpIcon } from "@/components/ui/arrow-up"
import { ArrowDownIcon } from "@/components/ui/arrow-down"
import { DeleteIcon } from "@/components/ui/delete"
import { cn } from "@/lib/utils"

// The existing schedule row, shared with figure ordering. Visuals remain Card/Button defaults.
export function SortableContentRow({
  id, index, selected, disabled = false, last, labels, children, onSelect, onMove, onRemove, editor, actions,
}: {
  id: string
  index: number
  selected: boolean
  disabled?: boolean
  last: boolean
  labels: { drag: string; select: string; up: string; down: string; remove: string }
  children: ReactNode
  editor?: { header: ReactNode; content: ReactNode }
  actions?: ReactNode
  onSelect: () => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
}) {
  const { ref, handleRef, isDragging } = useSortable({ id, index, disabled })
  const selectButton = (
    <Button type="button" variant={selected ? "secondary" : "ghost"} className="h-auto min-w-0 flex-1 justify-start text-left" aria-label={labels.select} aria-pressed={editor ? undefined : selected} disabled={disabled} onClick={editor ? undefined : onSelect}>
      {children}
    </Button>
  )
  const controls = (
    <>
      <Button ref={handleRef} type="button" variant="ghost" size="icon-sm" className="touch-none cursor-grab active:cursor-grabbing" aria-label={labels.drag} disabled={disabled}>
        <AnimatedActionIcon icon={GripVerticalIcon} />
      </Button>
      {editor ? selected ? editor.header : <CollapsibleTrigger render={selectButton} /> : selectButton}
      {actions ?? <>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={labels.up} disabled={disabled || index === 0} onClick={() => onMove(-1)}>
        <AnimatedActionIcon icon={ArrowUpIcon} />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={labels.down} disabled={disabled || last} onClick={() => onMove(1)}>
        <AnimatedActionIcon icon={ArrowDownIcon} />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={labels.remove} disabled={disabled} onClick={onRemove}>
        <AnimatedActionIcon icon={DeleteIcon} />
      </Button>
      </>}
    </>
  )
  if (editor) return (
    <Collapsible open={selected} onOpenChange={onSelect} render={<Card ref={ref} data-sortable-id={id} className={cn("min-w-0 gap-0 p-1", isDragging && "opacity-50")} />}>
      <div className="flex min-w-0 items-center gap-1">{controls}</div>
      <CollapsibleContent>{editor.content}</CollapsibleContent>
    </Collapsible>
  )
  return <Card ref={ref} data-sortable-id={id} className={cn("min-w-0 flex-row items-center gap-1 p-1", isDragging && "opacity-50")}>{controls}</Card>
}
