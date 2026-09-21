import { OutlineImportDialog } from "./outline-import-dialog"
import { PlusIcon } from "@/components/ui/plus"
import { ArrowLeftIcon } from "@/components/ui/arrow-left"
import { ArrowRightIcon } from "@/components/ui/arrow-right"
import { ArrowUpIcon } from "@/components/ui/arrow-up"
import { ArrowDownIcon } from "@/components/ui/arrow-down"
import { DeleteIcon } from "@/components/ui/delete"
import { AnimatedActionIcon } from "@/components/workbench/animated-action-icon"
import { useMemo, useState } from "react"


import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { StructuredContentEditor } from "@/components/workbench/structured-content-editor"
import { ContentStatistics } from "@/components/workbench/content-statistics"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { paragraphInputText } from "@/lib/paragraph"
import {
  DEFAULT_OUTLINE_NUMBERING_STYLE,
  numberOutlineItems,
  outlineStyleMaxDepth,
  OUTLINE_NUMBERING_STYLE_OPTIONS,
  type OutlineLevel,
  type OutlineNumberingStyle,
} from "@/lib/outline-numbering"
import { isParagraphInput } from "@/lib/structured-content-editor"
import type {
  ParagraphInput,
  StructuredBodyValue,
} from "@/types/structured-content"

export type { OutlineLevel, OutlineNumberingStyle }

export type OutlineEditorItem = {
  id: string
  level: OutlineLevel
  number: string
  title: ParagraphInput
}

type OutlineEditorProps = {
  value: OutlineEditorItem[]
  numberingStyle: OutlineNumberingStyle | null
  onChange: (value: OutlineEditorItem[]) => void
  onNumberingStyleChange: (value: OutlineNumberingStyle) => void
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

export function validateOutlineItems(
  value: OutlineEditorItem[],
  numberingStyle: OutlineNumberingStyle | null = null,
): string[] {
  if (value.length === 0) return ["论文目录至少需要一个条目。"]
  const errors: string[] = []
  const maximumLevel = numberingStyle
    ? outlineStyleMaxDepth(numberingStyle)
    : 6
  let previousLevel = 1
  value.forEach((item, index) => {
    const level = Number(item.level)
    if (!Number.isInteger(level) || level < 1 || level > maximumLevel) {
      errors.push(`第 ${index + 1} 条目录层级必须是 1 至 ${maximumLevel}。`)
    } else if (index === 0 && level !== 1) {
      errors.push("第一条目录必须是一级目录。")
    } else if (index > 0 && level > previousLevel + 1) {
      errors.push(`第 ${index + 1} 条目录不能跳过中间层级。`)
    }
    if (!paragraphInputText(item.title).trim()) {
      errors.push(`第 ${index + 1} 条目录缺少标题。`)
    }
    if (Number.isInteger(level) && level >= 1 && level <= maximumLevel) {
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
  style: OutlineNumberingStyle = DEFAULT_OUTLINE_NUMBERING_STYLE,
): OutlineEditorItem[] {
  return numberOutlineItems(value, style)
}

const levelPadding: Record<OutlineLevel, string> = {
  1: "pl-0",
  2: "pl-6",
  3: "pl-12",
  4: "pl-16",
  5: "pl-20",
  6: "pl-24",
}

export const FIXED_DIRECTORY_PREFIX = ["摘要", "Abstract"] as const
export const FIXED_DIRECTORY_SUFFIX = ["参考文献", "致谢"] as const

export function isFixedThesisDirectoryTitle(title: string): boolean {
  return [...FIXED_DIRECTORY_PREFIX, ...FIXED_DIRECTORY_SUFFIX].includes(
    title.trim() as (typeof FIXED_DIRECTORY_PREFIX)[number],
  )
}

function FixedDirectoryItem({ title }: { title: string }) {
  return (
    <div
      className="flex items-center rounded-lg border px-3 py-2"
      aria-label={`固定目录项：${title}`}
    >
      <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
      <span className="text-xs text-muted-foreground">固定</span>
    </div>
  )
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
  numberingStyle,
  onChange,
  onNumberingStyleChange,
  disabled = false,
  error,
}: OutlineEditorProps) {
  const [selectedId, setSelectedId] = useState(value[0]?.id ?? "")
  const validationErrors = useMemo(
    () => validateOutlineItems(value, numberingStyle),
    [numberingStyle, value],
  )
  const maximumLevel = numberingStyle
    ? outlineStyleMaxDepth(numberingStyle)
    : 6
  const displayedValue = useMemo(
    () => (numberingStyle ? numberOutlineItems(value, numberingStyle) : value),
    [numberingStyle, value],
  )
  const selectedIndex = Math.max(
    0,
    value.findIndex((item) => item.id === selectedId),
  )
  const selectedItem = value[selectedIndex]
  const fixedItemCount = FIXED_DIRECTORY_PREFIX.length + FIXED_DIRECTORY_SUFFIX.length
  const maximumUsedLevel = value.length
    ? Math.max(...value.map((item) => item.level))
    : 0

  const commit = (next: OutlineEditorItem[]) => {
    onChange(numberingStyle ? numberOutlineItems(next, numberingStyle) : next)
  }

  const replaceItem = (index: number, item: OutlineEditorItem) => {
    const next = [...value]
    next[index] = item
    commit(next)
  }

  const insertAfter = (index: number) => {
    const item = createOutlineEditorItem(value[index]?.level ?? 1)
    setSelectedId(item.id)
    commit([...value.slice(0, index + 1), item, ...value.slice(index + 1)])
  }

  const changeLevel = (index: number, direction: -1 | 1) => {
    const item = value[index]
    const nextLevel = item.level + direction
    if (nextLevel < 1 || nextLevel > maximumLevel) return
    const end = subtreeEnd(value, index)
    if (
      value
        .slice(index, end)
        .some(
          (entry) =>
            entry.level + direction < 1 ||
            entry.level + direction > maximumLevel,
        )
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
    commit(next)
  }

  const moveSubtree = (index: number, direction: -1 | 1) => {
    const end = subtreeEnd(value, index)
    const moving = value.slice(index, end)
    if (direction === -1) {
      const previous = previousSubtreeStart(value, index)
      if (previous === null) return
      commit([
        ...value.slice(0, previous),
        ...moving,
        ...value.slice(previous, index),
        ...value.slice(end),
      ])
      return
    }
    if (end >= value.length || value[end].level !== value[index].level) return
    const nextEnd = subtreeEnd(value, end)
    commit([
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
      commit([replacement])
      return
    }
    setSelectedId(next[Math.min(index, next.length - 1)].id)
    commit(next)
  }

  return (
    <TooltipProvider>
      <div className="grid min-h-0 gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {selectedItem ? (
            <div>
              <p className="text-sm font-medium">
                第 {selectedIndex + 1} 条目录标题
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <OutlineImportDialog disabled={disabled} onImport={(imported, replace) => {
              const added = imported.map(item => ({ ...createOutlineEditorItem(item.level), title: item.title }))
              const existing = value.length === 1 && !paragraphInputText(value[0].title).trim() ? [] : value
              const next = replace ? added : [...existing, ...added]
              onNumberingStyleChange("decimal_hierarchy")
              onChange(numberOutlineItems(next, "decimal_hierarchy"))
              setSelectedId(added[0]?.id ?? "")
            }} />
            <Select
              value={numberingStyle}
              onValueChange={(nextStyle) => {
                if (!nextStyle) return
                const style = nextStyle as OutlineNumberingStyle
                onNumberingStyleChange(style)
              }}
              disabled={disabled}
            >
              <SelectTrigger aria-label="目录类型" className="w-full sm:w-auto">
                <SelectValue placeholder="选择目录类型">
                  {numberingStyle
                    ? OUTLINE_NUMBERING_STYLE_OPTIONS.find(
                        (option) => option.value === numberingStyle,
                      )?.label
                    : "选择目录类型"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent
                align="end"
                alignItemWithTrigger={false}
                className="w-auto min-w-80"
              >
                {OUTLINE_NUMBERING_STYLE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <span>{option.label}</span>
                    <span className="text-muted-foreground">{option.example}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => {
                const item = createOutlineEditorItem()
                setSelectedId(item.id)
                commit([...value, item])
              }}
            >
              <span data-icon="inline-start"><AnimatedActionIcon icon={PlusIcon} /></span>
              新增目录
            </Button>
          </div>
        </div>

        {selectedItem ? (
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
        ) : null}

        <Separator />

        <div className="grid gap-2" aria-label="论文目录条目">
          {FIXED_DIRECTORY_PREFIX.map((title) => (
            <FixedDirectoryItem key={title} title={title} />
          ))}
          {displayedValue.map((item, index) => {
            const end = subtreeEnd(value, index)
            const hasChildren = end > index + 1
            const subtreeMaxLevel = Math.max(
              ...value.slice(index, end).map((entry) => entry.level),
            )
            const canIndent =
              index > 0 &&
              subtreeMaxLevel < maximumLevel &&
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
                  <span
                    aria-label={`第 ${index + 1} 条目录编号`}
                    className="w-24 shrink-0 truncate text-sm tabular-nums text-muted-foreground"
                  >
                    {item.number || "未编号"}
                  </span>
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
                      event.preventDefault()
                      if (event.shiftKey && canOutdent) {
                        changeLevel(index, -1)
                      } else if (!event.shiftKey && canIndent) {
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
                      <AnimatedActionIcon icon={ArrowLeftIcon} />
                    </IconAction>
                    <IconAction
                      label={`第 ${index + 1} 条目录：增加缩进`}
                      disabled={disabled || !canIndent}
                      onClick={() => changeLevel(index, 1)}
                    >
                      <AnimatedActionIcon icon={ArrowRightIcon} />
                    </IconAction>
                    <IconAction
                      label={`第 ${index + 1} 条目录：上移目录及其子目录`}
                      disabled={disabled || !canMoveUp}
                      onClick={() => moveSubtree(index, -1)}
                    >
                      <AnimatedActionIcon icon={ArrowUpIcon} />
                    </IconAction>
                    <IconAction
                      label={`第 ${index + 1} 条目录：下移目录及其子目录`}
                      disabled={disabled || !canMoveDown}
                      onClick={() => moveSubtree(index, 1)}
                    >
                      <AnimatedActionIcon icon={ArrowDownIcon} />
                    </IconAction>
                    <IconAction
                      label={`第 ${index + 1} 条目录：${hasChildren ? "请先处理子目录" : "删除目录"}`}
                      disabled={disabled || hasChildren}
                      onClick={() => removeItem(index)}
                    >
                      <AnimatedActionIcon icon={DeleteIcon} />
                    </IconAction>
                  </div>
                </div>
              </div>
            )
          })}
          {FIXED_DIRECTORY_SUFFIX.map((title) => (
            <FixedDirectoryItem key={title} title={title} />
          ))}
        </div>

        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0 flex-1">
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            {validationErrors.length ? (
              <p className="text-xs text-destructive">{validationErrors[0]}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                选择目录条目后在上方统一编辑标题；Enter 新建同级目录，Tab 增加缩进，Shift+Tab 减少缩进。
              </p>
            )}
          </div>
          <ContentStatistics
            summary={`目录 ${value.length + fixedItemCount} 项 · ${maximumUsedLevel} 级`}
            details={[
              { label: "目录条目", value: value.length + fixedItemCount },
              { label: "可编辑条目", value: value.length },
              { label: "固定条目", value: fixedItemCount },
              { label: "最大层级", value: maximumUsedLevel },
            ]}
          />
        </div>
      </div>
    </TooltipProvider>
  )
}
