import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { DragDropProvider } from "@dnd-kit/react"
import { isSortable } from "@dnd-kit/react/sortable"
import { toast } from "sonner"
import { SortableContentRow } from "@/components/sortable-content-row"
import { AnimatedActionIcon } from "@/components/animated-action-icon"
import { Button } from "@/components/ui/button"
import { CollapsibleTrigger } from "@/components/ui/collapsible"
import { FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PlusIcon } from "@/components/ui/plus"
import { DeleteIcon } from "@/components/ui/delete"
import { ChevronDownIcon } from "@/components/ui/chevron-down"
import { ChevronUpIcon } from "@/components/ui/chevron-up"
import { StructuredContentEditor } from "@/components/workbench/structured-content-editor"
import { paragraphInputText } from "@/lib/paragraph"
import { isParagraphInput } from "@/lib/structured-content-editor"
import { createTaskScheduleEditorItem, taskScheduleItemErrors, type TaskScheduleEditorItem } from "@/lib/task-schedule"
import type { ParagraphInput, StructuredBodyValue } from "@/types/structured-content"

type TaskScheduleEditorProps = {
  value: TaskScheduleEditorItem[]
  onChange: (value: TaskScheduleEditorItem[]) => void
  disabled?: boolean
  error?: string
  validationRequested?: boolean
}

function inlineBody(value: ParagraphInput): StructuredBodyValue {
  return paragraphInputText(value).length > 0 || typeof value !== "string" ? [value] : []
}

function inlineParagraph(value: StructuredBodyValue): ParagraphInput {
  const paragraph = value.find(isParagraphInput)
  return paragraph === undefined ? "" : structuredClone(paragraph)
}

export function TaskScheduleEditor({ value, onChange, disabled = false, error, validationRequested = false }: TaskScheduleEditorProps) {
  const [selectedId, setSelectedId] = useState<string | null>(value[0]?.id ?? null)
  const [focusRequest, setFocusRequest] = useState<{ id: string; field: "period" | "content" } | null>(null)
  const [touched, setTouched] = useState<Set<string>>(() => new Set())
  const root = useRef<HTMLDivElement>(null)
  const latest = useRef({ value, onChange, disabled })
  const receipts = useRef(new Set<string | number>())
  const selectedItem = value.find(item => item.id === selectedId)
    ?? (selectedId === null ? undefined : value[0])

  useLayoutEffect(() => { latest.current = { value, onChange, disabled } }, [value, onChange, disabled])
  useEffect(() => {
    const pending = receipts.current
    return () => { pending.forEach(id => toast.dismiss(id)); pending.clear() }
  }, [])
  useEffect(() => {
    if (!focusRequest || disabled) return
    const frame = requestAnimationFrame(() => {
      const row = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-sortable-id]") ?? [])
        .find(element => element.dataset.sortableId === focusRequest.id)
      const target = row?.querySelector<HTMLElement>(focusRequest.field === "period" ? "input" : '[contenteditable="true"]')
      target?.focus({ preventScroll: true })
      row?.scrollIntoView?.({ block: "nearest" })
    })
    return () => cancelAnimationFrame(frame)
  }, [focusRequest, disabled])

  const touch = (id: string, field: "period" | "content") => {
    setTouched(current => new Set(current).add(`${id}:${field}`))
  }
  const replaceItem = (index: number, item: TaskScheduleEditorItem) => {
    const next = [...value]
    next[index] = item
    onChange(next)
  }
  const moveItem = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (disabled || target < 0 || target >= value.length) return
    const next = [...value]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }
  const removeItem = (index: number) => {
    if (disabled) return
    const removed = structuredClone(value[index])
    const next = value.filter(item => item.id !== removed.id)
    const previousId = value[index - 1]?.id
    const nextId = value[index + 1]?.id
    const placeholder = next.length ? undefined : createTaskScheduleEditorItem()
    if (placeholder) next.push(placeholder)
    const removingSelected = selectedItem?.id === removed.id
    if (removingSelected || placeholder) {
      const neighbor = next[Math.min(index, next.length - 1)]
      setSelectedId(neighbor.id)
      setFocusRequest({ id: neighbor.id, field: placeholder ? "period" : "content" })
    }
    onChange(next)
    const remainingIds = new Set(next.map(item => item.id))
    const receipt = toast.info(`已删除第 ${index + 1} 项进度`, {
      action: {
        label: "撤销",
        onClick: () => {
          const current = latest.current
          // A receipt belongs to this mounted schedule, and must not overwrite
          // later edits or restore an item into a different document.
          if (current.disabled || current.value.some(item => item.id === removed.id)
            || !current.value.some(item => remainingIds.has(item.id))) return
          const restored = current.value.filter(item => !(item.id === placeholder?.id
            && !item.period.trim() && !paragraphInputText(item.content).trim()))
          if (restored.length >= 60) { toast.info("进度安排已达 60 项，请先删除一项后重试。"); return }
          const after = restored.findIndex(item => item.id === nextId)
          const before = restored.findIndex(item => item.id === previousId)
          restored.splice(after >= 0 ? after : before >= 0 ? before + 1 : Math.min(index, restored.length), 0, removed)
          current.onChange(restored)
          if (removingSelected) { setSelectedId(removed.id); setFocusRequest({ id: removed.id, field: "content" }) }
        },
      },
      onDismiss: () => receipts.current.delete(receipt),
      onAutoClose: () => receipts.current.delete(receipt),
    })
    receipts.current.add(receipt)
  }

  return (
    <div ref={root} className="grid min-h-0 gap-3">
      <DragDropProvider onDragEnd={(event) => {
        if (disabled || event.canceled) return
        const { source } = event.operation
        if (!isSortable(source)) return
        const { initialIndex, index } = source
        if (initialIndex === index || initialIndex < 0 || index < 0 || index >= value.length) return
        const next = [...value]
        const [moved] = next.splice(initialIndex, 1)
        next.splice(index, 0, moved)
        onChange(next)
      }}>
        <div className="grid gap-2" aria-label="进度安排">
          {value.map((item, index) => {
            const selected = item.id === selectedItem?.id
            const errors = taskScheduleItemErrors(item)
            const periodError = (validationRequested || error || touched.has(`${item.id}:period`)) ? errors.period : undefined
            const contentError = (validationRequested || error || touched.has(`${item.id}:content`)) ? errors.content : undefined
            const periodId = `task-schedule-period-${item.id}`
            const contentErrorId = `task-schedule-content-error-${item.id}`
            // dnd-kit's optimistic sorting moves these DOM elements directly.
            // Each sortable root must be a sibling in the grid that owns gap.
            return <SortableContentRow
                key={item.id}
                id={item.id} index={index} selected={selected} disabled={disabled} last={index === value.length - 1}
                labels={{ drag: `拖动第 ${index + 1} 项进度调整顺序`, select: `编辑第 ${index + 1} 项进度内容`, up: `第 ${index + 1} 项进度：上移`, down: `第 ${index + 1} 项进度：下移`, remove: `第 ${index + 1} 项进度：删除` }}
                onSelect={() => {
                  setSelectedId(selected ? null : item.id)
                  setFocusRequest(selected ? null : { id: item.id, field: "content" })
                }}
                onMove={direction => moveItem(index, direction)} onRemove={() => removeItem(index)}
                actions={<Button type="button" variant="ghost" size="icon-sm" aria-label={`第 ${index + 1} 项进度：删除`} title="删除进度" disabled={disabled} onClick={() => removeItem(index)}>
                  <AnimatedActionIcon icon={DeleteIcon} />
                </Button>}
                editor={{
                  header: <>
                    <CollapsibleTrigger render={<Button type="button" variant="ghost" size="sm" aria-label={`收起第 ${index + 1} 项进度`} disabled={disabled} />}>
                      第 {index + 1} 项<AnimatedActionIcon icon={ChevronUpIcon} />
                    </CollapsibleTrigger>
                    <div className="min-w-0 flex-1 py-1">
                      <FieldLabel className="sr-only" htmlFor={periodId}>时间范围</FieldLabel>
                      <Input id={periodId} aria-label={`第 ${index + 1} 项时间范围`} aria-invalid={Boolean(periodError)} aria-describedby={periodError ? `${periodId}-error` : undefined}
                        className="w-full" value={item.period} disabled={disabled} placeholder="例如：2026年11月1日—11月15日" maxLength={50}
                        onBlur={() => touch(item.id, "period")}
                        onKeyDown={event => {
                          if (event.key === "Tab" && !event.shiftKey) {
                            const content = event.currentTarget.closest("[data-sortable-id]")?.querySelector<HTMLElement>('[contenteditable="true"]')
                            if (content) { event.preventDefault(); content.focus() }
                          }
                        }}
                        onChange={event => replaceItem(index, { ...item, period: event.target.value })} />
                      {periodError ? <p id={`${periodId}-error`} className="mt-1 text-xs text-destructive">{periodError}</p> : null}
                    </div>
                  </>,
                  content: <div className="mt-1 border-t p-2" onBlurCapture={event => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) touch(item.id, "content")
                  }}>
                    <StructuredContentEditor value={inlineBody(item.content)} onChange={next => replaceItem(index, { ...item, content: inlineParagraph(next) })}
                      mode="inline" disabled={disabled} ariaLabel={`第 ${index + 1} 项进度内容`} ariaInvalid={Boolean(contentError)} ariaDescribedBy={contentError ? contentErrorId : undefined}
                      className="[&_[data-slot=editor-format-toolbar]]:h-8 [&_.ProseMirror]:min-h-10 [&_.ProseMirror]:py-2" placeholder="输入本阶段要完成的工作" />
                    {contentError ? <p id={contentErrorId} className="mt-1 text-xs text-destructive">{contentError}</p> : null}
                  </div>,
                }}
              >
                <span className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-left">
                  <span className="font-medium">第 {index + 1} 项</span>
                  <span className="whitespace-normal break-words text-muted-foreground">{item.period.trim() || "未填写时间范围"}</span>
                  <span className="col-span-2 line-clamp-2 whitespace-normal break-words font-normal text-muted-foreground">{paragraphInputText(item.content).trim() || "未填写进度内容"}</span>
                  {periodError || contentError ? <span className="col-span-full whitespace-normal text-xs text-destructive">{[periodError, contentError].filter(Boolean).join(" ")}</span> : null}
                </span>
                <AnimatedActionIcon icon={ChevronDownIcon} />
              </SortableContentRow>
          })}
        </div>
      </DragDropProvider>
      <Button className="justify-self-start" type="button" variant="outline" size="sm" disabled={disabled || value.length >= 60} onClick={() => {
        const item = createTaskScheduleEditorItem()
        setSelectedId(item.id)
        setFocusRequest({ id: item.id, field: "period" })
        onChange([...value, item])
      }}><AnimatedActionIcon icon={PlusIcon} data-icon="inline-start" />新增进度</Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
