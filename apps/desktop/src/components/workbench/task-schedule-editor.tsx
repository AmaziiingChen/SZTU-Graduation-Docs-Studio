import { useState } from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarRangeIcon,
  ListPlusIcon,
  Trash2Icon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
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
      <div className="flex flex-wrap items-center gap-2">
        <Button
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
          <ListPlusIcon data-icon="inline-start" />
          新增进度
        </Button>
        <Badge variant={validationErrors.length ? "destructive" : "outline"}>
          {validationErrors.length
            ? `${validationErrors.length} 项待处理`
            : `进度安排 · ${value.length} 项`}
        </Badge>
      </div>

      {selectedItem ? (
        <div className="grid gap-3">
          <div className="grid gap-1">
            <p className="text-sm font-medium">
              第 {selectedIndex + 1} 项进度内容
            </p>
            <p className="text-xs text-muted-foreground">
              内容支持粗体、斜体和上下标；时间范围在下方对应条目中填写。
            </p>
          </div>
          <StructuredContentEditor
            key={selectedItem.id}
            value={inlineBody(selectedItem.content)}
            onChange={(content) =>
              replaceItem(selectedIndex, {
                ...selectedItem,
                content: inlineParagraph(content),
              })
            }
            mode="inline"
            disabled={disabled}
            ariaLabel={`第 ${selectedIndex + 1} 项进度内容`}
            ariaInvalid={!paragraphInputText(selectedItem.content).trim()}
            placeholder="输入本阶段要完成的工作"
          />
        </div>
      ) : null}

      <Separator />

      <div className="grid gap-2" aria-label="进度安排条目">
        {value.map((item, index) => {
          const content = paragraphInputText(item.content).trim()
          const selected = index === selectedIndex
          return (
            <div
              className="grid gap-2 rounded-lg border p-2 md:grid-cols-[minmax(8rem,0.35fr)_minmax(0,1fr)_auto] md:items-center"
              key={item.id}
            >
              <Input
                aria-label={`第 ${index + 1} 项时间范围`}
                value={item.period}
                disabled={disabled}
                placeholder="例如：第1—2周"
                maxLength={50}
                onChange={(event) =>
                  replaceItem(index, { ...item, period: event.target.value })
                }
              />
              <Button
                type="button"
                variant={selected ? "secondary" : "ghost"}
                className="min-w-0 justify-start"
                aria-label={`编辑第 ${index + 1} 项进度内容`}
                disabled={disabled}
                onClick={() => setSelectedId(item.id)}
              >
                <CalendarRangeIcon />
                <span className="truncate">
                  {content || "选择后填写本阶段进度内容"}
                </span>
              </Button>
              <div className="flex items-center justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`第 ${index + 1} 项进度：上移`}
                  disabled={disabled || index === 0}
                  onClick={() => moveItem(index, -1)}
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`第 ${index + 1} 项进度：下移`}
                  disabled={disabled || index === value.length - 1}
                  onClick={() => moveItem(index, 1)}
                >
                  <ArrowDownIcon />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`第 ${index + 1} 项进度：删除`}
                  disabled={disabled}
                  onClick={() => removeItem(index)}
                >
                  <Trash2Icon />
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {validationErrors.length ? (
        <p className="text-xs text-destructive">{validationErrors[0]}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          条目按当前顺序写入任务书；不再使用“时间范围 | 内容”的文本协议。
        </p>
      )}
    </div>
  )
}
