import { useEffect, useRef, type ComponentType, type RefAttributes } from "react"
import { cn } from "@/lib/utils"
import { useReducedMotion } from "motion/react"

interface AnimationHandle {
  startAnimation: () => void
  stopAnimation: () => void
}

// Adapt the registry icon to its existing action, without adding another button
// or changing its hit area, keyboard behavior, or accessible name.
export function AnimatedActionIcon({ icon: Icon, playOnMount = false, className, size = 16 }: {
  size?: number
  playOnMount?: boolean
  className?: string
  icon: ComponentType<{ size?: number; className?: string } & RefAttributes<AnimationHandle>>
}) {
  const element = useRef<HTMLSpanElement>(null)
  const animation = useRef<AnimationHandle>(null)
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    if (playOnMount && !reducedMotion) animation.current?.startAnimation()
    if (playOnMount) return
    const action = element.current?.closest<HTMLElement>('button, [role="button"], [role="menuitem"], [role="tab"], [role="combobox"], [role="option"]')
    if (!action) return
    const start = () => {
      if (!reducedMotion && !action.matches(':disabled, [aria-disabled="true"], [data-disabled]')) {
        animation.current?.startAnimation()
      }
    }
    const stop = () => {
      animation.current?.stopAnimation()
    }
    if (reducedMotion) stop()
    action.addEventListener("mouseenter", start)
    action.addEventListener("mouseleave", stop)
    action.addEventListener("focus", start)
    action.addEventListener("blur", stop)
    return () => {
      stop()
      action.removeEventListener("mouseenter", start)
      action.removeEventListener("mouseleave", stop)
      action.removeEventListener("focus", start)
      action.removeEventListener("blur", stop)
    }
  }, [reducedMotion, Icon, playOnMount])

  return (
    <span ref={element} aria-hidden="true" className={cn("inline-flex size-4 shrink-0", className)} style={size === 16 ? undefined : { width: size, height: size }}>
      <Icon ref={animation} size={size} className="size-full" />
    </span>
  )
}
