import { PlusIcon } from "@/components/ui/plus"
import { GripVerticalIcon as GripVerticalIconAnimated } from "@/components/ui/grip-vertical"
import { ArrowUpIcon } from "@/components/ui/arrow-up"
import { ArrowDownIcon } from "@/components/ui/arrow-down"
import { DeleteIcon } from "@/components/ui/delete"
import { AnimatedActionIcon } from "@/components/workbench/animated-action-icon"
import { useState } from "react"
import { DragDropProvider } from "@dnd-kit/react"
import { isSortable, useSortable } from "@dnd-kit/react/sortable"


import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { StructuredContentEditor } from "@/components/workbench/structured-content-editor"
import { paragraphInputText } from "@/lib/paragraph"
import { isParagraphInput } from "@/lib/structured-content-editor"
import {
  createTaskScheduleEditorItem,
  validateTaskScheduleItems,
  type TaskScheduleEditorItem,
} from "@/lib/task-schedule"
import type {
  ParagraphInput,
  StructuredBodyValue,
} from "@/types/structured-content"

type TaskScheduleEditorProps = {
  value: TaskScheduleEditorItem[]
  onChange: (value: TaskScheduleEditorItem[]) => void
  disabled?: boolean
  error?: string
}

function inlineBody(value: ParagraphInput): StructuredBodyValue {
  return paragraphInputText(value).length > 0 || typeof value !== "string"
    ? [value]
    : []
}

function inlineParagraph(value: StructuredBodyValue): ParagraphInput {
  const paragraph = value.find(isParagraphInput)
  return paragraph === undefined ? "" : structuredClone(paragraph)
}

type SortableScheduleRowProps = {
  item: TaskScheduleEditorItem
  index: number
  selected: boolean
  disabled: boolean
  last: boolean
  onSelect: () => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
}

function SortableScheduleRow({
  item,
  index,
  selected,
  disabled,
  last,
  onSelect,
  onMove,
  onRemove,
}: SortableScheduleRowProps) {
  const { ref, handleRef, isDragging } = useSortable({
    id: item.id,
    index,
    disabled,
  })
  const content = paragraphInputText(item.content).trim()

  return (
    <div
      ref={ref}
      className={`flex min-w-0 items-center gap-1 rounded-lg border p-1 ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <Button
        ref={handleRef}
        type="button"
        variant="ghost"
        size="icon-sm"
        className="cursor-grab active:cursor-grabbing"
        aria-label={`拖动第 ${index + 1} 项进度调整顺序`}
        disabled={disabled}
      >
        <AnimatedActionIcon icon={GripVerticalIconAnimated} />
      </Button>
      <Button
        type="button"
        variant={selected ? "secondary" : "ghost"}
        className="h-auto min-w-0 flex-1 justify-start px-3 py-2"
        aria-label={`编辑第 ${index + 1} 项进度内容`}
        disabled={disabled}
        onClick={onSelect}
      >
        <span className="grid min-w-0 flex-1 gap-1 text-left sm:grid-cols-[4rem_12rem_minmax(0,1fr)] sm:items-center sm:gap-3">
          <span className="font-medium">第 {index + 1} 项</span>
          <span className="truncate text-muted-foreground">
            {item.period.trim() || "未填写时间范围"}
          </span>
          <span className="truncate font-normal text-muted-foreground">
            {content || "未填写进度内容"}
          </span>
        </span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`第 ${index + 1} 项进度：上移`}
        disabled={disabled || index === 0}
        onClick={() => onMove(-1)}
      >
        <AnimatedActionIcon icon={ArrowUpIcon} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`第 ${index + 1} 项进度：下移`}
        disabled={disabled || last}
        onClick={() => onMove(1)}
      >
        <AnimatedActionIcon icon={ArrowDownIcon} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`第 ${index + 1} 项进度：删除`}
        disabled={disabled}
        onClick={onRemove}
      >
        <AnimatedActionIcon icon={DeleteIcon} />
      </Button>
    </div>
  )
}

export function TaskScheduleEditor({
  value,
  onChange,
  disabled = false,
  error,
}: TaskScheduleEditorProps) {
  const [selectedId, setSelectedId] = useState(value[0]?.id ?? "")
  const selectedIndex = Math.max(
    0,
    value.findIndex((item) => item.id === selectedId),
  )
  const selectedItem = value[selectedIndex]
  const validationErrors = validateTaskScheduleItems(value)

  const replaceItem = (index: number, item: TaskScheduleEditorItem) => {
    const next = [...value]
    next[index] = item
    onChange(next)
  }

  const moveItem = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= value.length) return
    const next = [...value]
    const current = next[index]
    next[index] = next[target]
    next[target] = current
    onChange(next)
  }

  const removeItem = (index: number) => {
    const next = value.filter((_, itemIndex) => itemIndex !== index)
    if (next.length === 0) {
      const replacement = createTaskScheduleEditorItem()
      setSelectedId(replacement.id)
      onChange([replacement])
      return
    }
    setSelectedId(next[Math.min(index, next.length - 1)].id)
    onChange(next)
  }

  return (
    <div className="grid min-h-0 gap-4">
      {selectedItem ? (
        <Card className="bg-background" size="sm" key={selectedItem.id}>
          <CardHeader className="border-b">
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle className="mr-1 shrink-0">
                第 {selectedIndex + 1} 项进度
              </CardTitle>
              <label
                className="shrink-0 text-sm font-medium"
                htmlFor={`task-schedule-period-${selectedItem.id}`}
              >
                时间范围
              </label>
              <Input
                className="w-full sm:w-64"
                id={`task-schedule-period-${selectedItem.id}`}
                aria-label={`第 ${selectedIndex + 1} 项时间范围`}
                value={selectedItem.period}
                disabled={disabled}
                autoFocus
                placeholder="例如：第1—2周"
                maxLength={50}
                onChange={(event) =>
                  replaceItem(selectedIndex, {
                    ...selectedItem,
                    period: event.target.value,
                  })
                }
              />
              <Button
                className="sm:ml-auto"
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || value.length >= 60}
                onClick={() => {
                  const item = createTaskScheduleEditorItem()
                  setSelectedId(item.id)
                  onChange([...value, item])
                }}
              >
                <span data-icon="inline-start"><AnimatedActionIcon icon={PlusIcon} /></span>
                新增进度
              </Button>
            </div>
          </CardHeader>
          <CardContent className="min-w-0">
            <StructuredContentEditor
              key={selectedItem.id}
              value={inlineBody(selectedItem.content)}
              onChange={(nextContent) =>
                replaceItem(selectedIndex, {
                  ...selectedItem,
                  content: inlineParagraph(nextContent),
                })
              }
              mode="inline"
              disabled={disabled}
              ariaLabel={`第 ${selectedIndex + 1} 项进度内容`}
              ariaInvalid={!paragraphInputText(selectedItem.content).trim()}
              placeholder="输入本阶段要完成的工作"
            />
          </CardContent>
        </Card>
      ) : null}

      <DragDropProvider
        onDragEnd={(event) => {
          if (event.canceled) return
          const { source } = event.operation
          if (!isSortable(source)) return
          const { initialIndex, index } = source
          if (initialIndex === index) return
          const next = [...value]
          const [moved] = next.splice(initialIndex, 1)
          next.splice(index, 0, moved)
          onChange(next)
        }}
      >
        <div className="grid gap-2" aria-label="进度安排预览">
          {value.map((item, index) => (
            <SortableScheduleRow
              key={item.id}
              item={item}
              index={index}
              selected={item.id === selectedItem?.id}
              disabled={disabled}
              last={index === value.length - 1}
              onSelect={() => setSelectedId(item.id)}
              onMove={(direction) => moveItem(index, direction)}
              onRemove={() => removeItem(index)}
            />
          ))}
        </div>
      </DragDropProvider>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {validationErrors.length ? (
        <p className="text-xs text-destructive">{validationErrors[0]}</p>
      ) : null}
    </div>
  )
}
