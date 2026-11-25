import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { Button } from "@/components/ui/button"

type TourStep = {
  title: string
  body: string
  selector: string | null
  requiresClick?: boolean
}

const STEPS: TourStep[] = [
  {
    title: "先填一次基本信息",
    body: "姓名、学号、学院、专业、导师只需要填一次，之后所有材料都会自动带出。",
    selector: '[data-tour="nav-profile"]',
    requiresClick: true,
  },
  {
    title: "在这里填写档案",
    body: "论文题目也可以在这里修改。学号请按学校格式填写，导出时会原样带到材料封面。",
    selector: '[data-tour="profile-form"]',
  },
  {
    title: "新建第一份任务书",
    body: "回到左侧，点「任务书」右侧的加号，就会新建一份任务书。",
    selector: '[data-tour="create-task-book"]',
    requiresClick: true,
  },
  {
    title: "按提示逐项填写",
    body: "右侧会列出这份材料需要的章节，按顺序填写即可；保存是自动的，不用找保存按钮。",
    selector: '[data-tour="section-list"]',
  },
  {
    title: "预览并导出",
    body: "填写完成后点右上角「预览&导出」，先看分页效果，确认无误再导出 PDF（推荐）或 Word。",
    selector: '[data-tour="preview-export"]',
    requiresClick: true,
  },
  {
    title: "就这三步",
    body: "填资料、写正文、导出。遇到问题点左下角「帮助」，也可以随时在帮助里重新播放这个引导。",
    selector: null,
  },
]

const CARD_WIDTH = 340
const CARD_MARGIN = 16

export function FirstRunTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const step = STEPS[index]
  const lastStep = index === STEPS.length - 1

  useEffect(() => {
    if (!open) return
    let frame = 0
    const update = () => {
      const target = step.selector ? document.querySelector<HTMLElement>(step.selector) : null
      const next = target
        ? (() => {
            const bounds = target.getBoundingClientRect()
            return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }
          })()
        : null
      frame = window.requestAnimationFrame(() => setRect(next))
    }
    update()
    const onResize = () => update()
    window.addEventListener("resize", onResize)
    window.addEventListener("scroll", onResize, true)
    const timer = window.setInterval(update, 600)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener("resize", onResize)
      window.removeEventListener("scroll", onResize, true)
      window.clearInterval(timer)
    }
  }, [open, step.selector])

  useEffect(() => {
    if (!open) return
    if (!step.requiresClick || !rect) return
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest(step.selector ?? "")) {
        setIndex((current) => Math.min(current + 1, STEPS.length - 1))
      }
    }
    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [open, rect, step.requiresClick, step.selector])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    cardRef.current?.focus({ preventScroll: true })
  }, [open, index])

  const cardPosition = useMemo(() => {
    if (typeof window === "undefined") return { left: CARD_MARGIN, top: CARD_MARGIN }
    const width = Math.min(CARD_WIDTH, window.innerWidth - CARD_MARGIN * 2)
    if (!rect) {
      return {
        left: Math.max(CARD_MARGIN, (window.innerWidth - width) / 2),
        top: Math.max(CARD_MARGIN, (window.innerHeight - 220) / 2),
        width,
      }
    }
    const centered = rect.left + rect.width / 2 - width / 2
    const left = Math.min(Math.max(CARD_MARGIN, centered), window.innerWidth - width - CARD_MARGIN)
    const below = rect.top + rect.height + 12
    const fitsBelow = below + 220 < window.innerHeight
    const top = fitsBelow ? below : Math.max(CARD_MARGIN, rect.top - 232)
    if (rect.width <= 220) {
      const right = rect.left + rect.width + CARD_MARGIN
      if (right + width < window.innerWidth) {
        return {
          left: right,
          top: Math.min(Math.max(CARD_MARGIN, rect.top), Math.max(CARD_MARGIN, window.innerHeight - 260)),
          width,
        }
      }
    }
    return { left, top, width }
  }, [rect])

  if (!open) return null

  const targetMissing = step.selector !== null && rect === null

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[120]">
      {rect ? (
        <div
          aria-hidden="true"
          className="fixed rounded-lg ring-2 ring-primary/80 transition-all duration-200"
          style={{
            left: rect.left - 6,
            top: rect.top - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: "0 0 0 9999px color-mix(in srgb, var(--foreground) 55%, transparent)",
          }}
        />
      ) : (
        <div aria-hidden="true" className="fixed inset-0 bg-foreground/55" />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-label="新手引导"
        aria-live="polite"
        tabIndex={-1}
        className="pointer-events-auto fixed rounded-xl border bg-background p-4 shadow-xl outline-none"
        style={{ left: cardPosition.left, top: cardPosition.top, width: cardPosition.width }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            第 {index + 1} 步 / 共 {STEPS.length} 步
          </span>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs text-muted-foreground"
            onClick={onClose}
          >
            跳过引导
          </Button>
        </div>
        <h2 className="mt-2 text-base font-medium">{step.title}</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{step.body}</p>
        {step.requiresClick && !targetMissing ? (
          <p className="mt-3 text-xs font-medium text-primary">请点击高亮的按钮继续</p>
        ) : null}
        {targetMissing ? (
          <p className="mt-3 text-xs text-muted-foreground">这个按钮当前不可见，先继续下一步。</p>
        ) : null}
        <div className="mt-4 flex items-center justify-end gap-2">
          {lastStep ? (
            <Button size="sm" onClick={onClose}>完成</Button>
          ) : step.requiresClick && !targetMissing ? null : (
            <Button size="sm" onClick={() => setIndex((current) => current + 1)}>
              下一步
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
