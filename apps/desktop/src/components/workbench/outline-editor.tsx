import { useMemo, useState } from "react"
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ListPlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { StructuredContentEditor } from "@/components/workbench/structured-content-editor"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { paragraphInputText } from "@/lib/paragraph"
import { isParagraphInput } from "@/lib/structured-content-editor"
import type {
  ParagraphInput,
  StructuredBodyValue,
} from "@/types/structured-content"

export type OutlineLevel = 1 | 2 | 3 | 4

export type OutlineEditorItem = {
  id: string
  level: OutlineLevel
  number: string
  title: ParagraphInput
}

type OutlineEditorProps = {
  value: OutlineEditorItem[]
  onChange: (value: OutlineEditorItem[]) => void
  disabled?: boolean
  error?: string
}

let generatedId = 0

export function createOutlineEditorItem(
  level: OutlineLevel = 1,
): OutlineEditorItem {
  generatedId += 1
  return {
    id: `outline-${Date.now()}-${generatedId}`,
    level,
    number: "",
    title: "",
  }
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

export function validateOutlineItems(value: OutlineEditorItem[]): string[] {
  if (value.length === 0) return ["论文目录至少需要一个条目。"]
  const errors: string[] = []
  let previousLevel = 1
  value.forEach((item, index) => {
    const level = Number(item.level)
    if (!Number.isInteger(level) || level < 1 || level > 4) {
      errors.push(`第 ${index + 1} 条目录层级必须是 1 至 4。`)
    } else if (index === 0 && level !== 1) {
      errors.push("第一条目录必须是一级目录。")
    } else if (index > 0 && level > previousLevel + 1) {
      errors.push(`第 ${index + 1} 条目录不能跳过中间层级。`)
    }
    if (!paragraphInputText(item.title).trim()) {
      errors.push(`第 ${index + 1} 条目录缺少标题。`)
    }
    if (Number.isInteger(level) && level >= 1 && level <= 4) {
      previousLevel = level
    }
  })
  return errors
}

function subtreeEnd(value: OutlineEditorItem[], start: number): number {
  const level = value[start]?.level ?? 1
  let end = start + 1
  while (end < value.length && value[end].level > level) end += 1
  return end
}

function previousSubtreeStart(
  value: OutlineEditorItem[],
  start: number,
): number | null {
  if (start <= 0) return null
  const level = value[start].level
  let candidate = start - 1
  while (candidate >= 0 && value[candidate].level > level) candidate -= 1
  return candidate >= 0 && value[candidate].level === level ? candidate : null
}

export function renumberOutlineItems(
  value: OutlineEditorItem[],
): OutlineEditorItem[] {
  const counters = [0, 0, 0, 0]
  return value.map((item) => {
    counters[item.level - 1] += 1
    counters.fill(0, item.level)
    return {
      ...item,
      number: counters.slice(0, item.level).join("."),
    }
  })
}

const levelPadding: Record<OutlineLevel, string> = {
  1: "pl-0",
  2: "pl-6",
  3: "pl-12",
  4: "pl-16",
}

function IconAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function OutlineEditor({
  value,
  onChange,
  disabled = false,
  error,
}: OutlineEditorProps) {
  const [selectedId, setSelectedId] = useState(value[0]?.id ?? "")
  const validationErrors = useMemo(() => validateOutlineItems(value), [value])
  const selectedIndex = Math.max(
    0,
    value.findIndex((item) => item.id === selectedId),
  )
  const selectedItem = value[selectedIndex]

  const replaceItem = (index: number, item: OutlineEditorItem) => {
    const next = [...value]
    next[index] = item
    onChange(next)
  }

  const insertAfter = (index: number) => {
    const item = createOutlineEditorItem(value[index]?.level ?? 1)
    setSelectedId(item.id)
    onChange([...value.slice(0, index + 1), item, ...value.slice(index + 1)])
  }

  const changeLevel = (index: number, direction: -1 | 1) => {
    const item = value[index]
    const nextLevel = item.level + direction
    if (nextLevel < 1 || nextLevel > 4) return
    const end = subtreeEnd(value, index)
    if (
      value
        .slice(index, end)
        .some((entry) => entry.level + direction < 1 || entry.level + direction > 4)
    ) {
      return
    }
    if (direction === 1) {
      if (index === 0 || nextLevel > value[index - 1].level + 1) return
    }
    const next = value.map((entry, entryIndex) => {
      if (entryIndex < index || entryIndex >= end) return entry
      return {
        ...entry,
        level: (entry.level + direction) as OutlineLevel,
      }
    })
    onChange(next)
  }

  const moveSubtree = (index: number, direction: -1 | 1) => {
    const end = subtreeEnd(value, index)
    const moving = value.slice(index, end)
    if (direction === -1) {
      const previous = previousSubtreeStart(value, index)
      if (previous === null) return
      onChange([
        ...value.slice(0, previous),
        ...moving,
        ...value.slice(previous, index),
        ...value.slice(end),
      ])
      return
    }
    if (end >= value.length || value[end].level !== value[index].level) return
    const nextEnd = subtreeEnd(value, end)
    onChange([
      ...value.slice(0, index),
      ...value.slice(end, nextEnd),
      ...moving,
      ...value.slice(nextEnd),
    ])
  }

  const removeItem = (index: number) => {
    const end = subtreeEnd(value, index)
    if (end > index + 1) return
    const next = value.filter((_, entryIndex) => entryIndex !== index)
    if (next.length === 0) {
      const replacement = createOutlineEditorItem()
      setSelectedId(replacement.id)
      onChange([replacement])
      return
    }
    setSelectedId(next[Math.min(index, next.length - 1)].id)
    onChange(next)
  }

  return (
    <TooltipProvider>
      <div className="grid min-h-0 gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => {
              const item = createOutlineEditorItem()
              setSelectedId(item.id)
              onChange([...value, item])
            }}
          >
            <ListPlusIcon data-icon="inline-start" />
            新增目录
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || validationErrors.length > 0}
            onClick={() => onChange(renumberOutlineItems(value))}
          >
            <RefreshCwIcon data-icon="inline-start" />
            重新编号
          </Button>
          <Separator orientation="vertical" className="h-5" />
          <Badge variant={validationErrors.length ? "destructive" : "outline"}>
            {validationErrors.length
              ? `${validationErrors.length} 项待处理`
              : `目录 · ${value.length} 项`}
          </Badge>
        </div>

        {selectedItem ? (
          <div className="grid gap-2">
            <div className="grid gap-1">
              <p className="text-sm font-medium">
                第 {selectedIndex + 1} 条目录标题
              </p>
              <p className="text-xs text-muted-foreground">
                标题支持粗体、斜体和上下标；目录层级与编号在下方对应条目中维护。
              </p>
            </div>
            <StructuredContentEditor
              key={selectedItem.id}
              value={inlineBody(selectedItem.title)}
              onChange={(title) =>
                replaceItem(selectedIndex, {
                  ...selectedItem,
                  title: inlineParagraph(title),
                })
              }
              mode="inline"
              disabled={disabled}
              ariaLabel={`第 ${selectedIndex + 1} 条目录标题`}
              ariaInvalid={!paragraphInputText(selectedItem.title).trim()}
              placeholder="输入目录标题"
            />
          </div>
        ) : null}

        <Separator />

        <div className="grid gap-2" aria-label="论文目录条目">
          {value.map((item, index) => {
            const end = subtreeEnd(value, index)
            const hasChildren = end > index + 1
            const subtreeMaxLevel = Math.max(
              ...value.slice(index, end).map((entry) => entry.level),
            )
            const canIndent =
              index > 0 &&
              subtreeMaxLevel < 4 &&
              item.level <= value[index - 1].level
            const canOutdent = item.level > 1
            const canMoveUp = previousSubtreeStart(value, index) !== null
            const canMoveDown =
              end < value.length && value[end].level === item.level
            return (
              <div className={levelPadding[item.level]} key={item.id}>
                <div className="flex items-center gap-2 rounded-lg border bg-background p-2">
                  <Badge variant="secondary" className="shrink-0">
                    {item.level} 级
                  </Badge>
                  <Input
                    aria-label={`第 ${index + 1} 条目录编号`}
                    className="w-24 shrink-0"
                    value={item.number}
                    disabled={disabled}
                    placeholder="编号"
                    maxLength={20}
                    onChange={(event) =>
                      replaceItem(index, { ...item, number: event.target.value })
                    }
                  />
                  <Button
                    type="button"
                    variant={index === selectedIndex ? "secondary" : "ghost"}
                    aria-label={`第 ${index + 1} 条目录标题`}
                    aria-invalid={!paragraphInputText(item.title).trim()}
                    className="min-w-0 flex-1 justify-start"
                    disabled={disabled}
                    onClick={() => setSelectedId(item.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault()
                        insertAfter(index)
                        return
                      }
                      if (event.key !== "Tab") return
                      if (event.shiftKey && canOutdent) {
                        event.preventDefault()
                        changeLevel(index, -1)
                      } else if (!event.shiftKey && canIndent) {
                        event.preventDefault()
                        changeLevel(index, 1)
                      }
                    }}
                  >
                    <span className="truncate">
                      {paragraphInputText(item.title).trim() || "选择后填写目录标题"}
                    </span>
                  </Button>
                  <div className="flex shrink-0 items-center">
                    <IconAction
                      label={`第 ${index + 1} 条目录：减少缩进`}
                      disabled={disabled || !canOutdent}
                      onClick={() => changeLevel(index, -1)}
                    >
                      <ArrowLeftIcon />
                    </IconAction>
                    <IconAction
                      label={`第 ${index + 1} 条目录：增加缩进`}
                      disabled={disabled || !canIndent}
                      onClick={() => changeLevel(index, 1)}
                    >
                      <ArrowRightIcon />
                    </IconAction>
                    <IconAction
                      label={`第 ${index + 1} 条目录：上移目录及其子目录`}
                      disabled={disabled || !canMoveUp}
                      onClick={() => moveSubtree(index, -1)}
                    >
                      <ArrowUpIcon />
                    </IconAction>
                    <IconAction
                      label={`第 ${index + 1} 条目录：下移目录及其子目录`}
                      disabled={disabled || !canMoveDown}
                      onClick={() => moveSubtree(index, 1)}
                    >
                      <ArrowDownIcon />
                    </IconAction>
                    <IconAction
                      label={`第 ${index + 1} 条目录：${hasChildren ? "请先处理子目录" : "删除目录"}`}
                      disabled={disabled || hasChildren}
                      onClick={() => removeItem(index)}
                    >
                      <Trash2Icon />
                    </IconAction>
                  </div>
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
            选择目录条目后在上方统一编辑标题；Enter 新建同级目录，Tab 增加缩进，Shift+Tab 减少缩进。
          </p>
        )}
      </div>
    </TooltipProvider>
  )
}
