import type { ReactNode } from "react"
import { useSortable } from "@dnd-kit/react/sortable"
import { AnimatedActionIcon } from "@/components/animated-action-icon"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { GripVerticalIcon } from "@/components/ui/grip-vertical"
import { ArrowUpIcon } from "@/components/ui/arrow-up"
import { ArrowDownIcon } from "@/components/ui/arrow-down"
import { DeleteIcon } from "@/components/ui/delete"
import { cn } from "@/lib/utils"

// The existing schedule row, shared with figure ordering. Visuals remain Card/Button defaults.
export function SortableContentRow({
  id, index, selected, disabled = false, last, labels, children, onSelect, onMove, onRemove,
}: {
  id: string
  index: number
  selected: boolean
  disabled?: boolean
  last: boolean
  labels: { drag: string; select: string; up: string; down: string; remove: string }
  children: ReactNode
  onSelect: () => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
}) {
  const { ref, handleRef, isDragging } = useSortable({ id, index, disabled })
  return (
    <Card ref={ref} className={cn("min-w-0 flex-row items-center gap-1 p-1", isDragging && "opacity-50")}>
      <Button ref={handleRef} type="button" variant="ghost" size="icon-sm" className="touch-none cursor-grab active:cursor-grabbing" aria-label={labels.drag} disabled={disabled}>
        <AnimatedActionIcon icon={GripVerticalIcon} />
      </Button>
      <Button type="button" variant={selected ? "secondary" : "ghost"} className="h-auto min-w-0 flex-1 justify-start text-left" aria-label={labels.select} aria-pressed={selected} disabled={disabled} onClick={onSelect}>
        {children}
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={labels.up} disabled={disabled || index === 0} onClick={() => onMove(-1)}>
        <AnimatedActionIcon icon={ArrowUpIcon} />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={labels.down} disabled={disabled || last} onClick={() => onMove(1)}>
        <AnimatedActionIcon icon={ArrowDownIcon} />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={labels.remove} disabled={disabled} onClick={onRemove}>
        <AnimatedActionIcon icon={DeleteIcon} />
      </Button>
    </Card>
  )
}
