import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { CircleAlertIcon } from "lucide-react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { DocumentSectionState } from "@/components/workbench/document-section-nav"
import { cn } from "@/lib/utils"

const completionAnimationDuration = 420

function StatusTooltip({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "ml-2 inline-flex size-5 shrink-0 items-center justify-center",
              className,
            )}
          />
        }
      >
        {children}
        <span className="sr-only">{label}</span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function SectionCompletionMark({
  state,
  completeLabel = "已填写",
  errorLabel = "需修改",
  className,
  animateOnMount = false,
}: {
  state: DocumentSectionState
  completeLabel?: string
  errorLabel?: string
  className?: string
  animateOnMount?: boolean
}) {
  const previousStateRef = useRef<DocumentSectionState>(
    animateOnMount && state === "complete" ? "incomplete" : state,
  )
  const animationTimerRef = useRef<number | null>(null)
  const [animationActive, setAnimationActive] = useState(false)

  useLayoutEffect(() => {
    const previousState = previousStateRef.current
    previousStateRef.current = state
    if (state !== "complete" || previousState === "complete") return

    // oxlint-disable-next-line react/set-state-in-effect -- a layout effect starts the completion animation before the newly completed mark is painted.
    setAnimationActive(true)
    if (animationTimerRef.current !== null) {
      window.clearTimeout(animationTimerRef.current)
    }
    animationTimerRef.current = window.setTimeout(() => {
      animationTimerRef.current = null
      setAnimationActive(false)
    }, completionAnimationDuration)
  }, [state])

  useEffect(
    () => () => {
      if (animationTimerRef.current !== null) {
        window.clearTimeout(animationTimerRef.current)
      }
    },
    [],
  )

  if (state === "incomplete") {
    return (
      <span className="ml-2 inline-flex size-5 shrink-0">
        <span className="sr-only">未完成</span>
      </span>
    )
  }

  if (state === "error") {
    return (
      <StatusTooltip label={errorLabel} className={className}>
        <CircleAlertIcon className="size-4 text-destructive" aria-hidden="true" />
      </StatusTooltip>
    )
  }

  return (
    <StatusTooltip label={completeLabel} className={className}>
      <svg
        data-slot="section-completion-mark"
        data-animate={animationActive ? "true" : "false"}
        viewBox="0 0 20 20"
        className="size-5 overflow-visible"
        aria-hidden="true"
      >
        <circle
          className="section-completion-circle fill-emerald-500"
          cx="10"
          cy="10"
          r="8.5"
        />
        <path
          className="section-completion-check stroke-white"
          d="m6.2 10.1 2.55 2.55 5.15-5.15"
          pathLength="1"
          fill="none"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </StatusTooltip>
  )
}
