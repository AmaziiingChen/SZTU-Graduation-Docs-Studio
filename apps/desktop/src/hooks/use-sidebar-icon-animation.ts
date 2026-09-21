import { useRef } from "react"
import { useReducedMotion } from "motion/react"

interface IconHandle {
  startAnimation: () => void
  stopAnimation: () => void
}

// Keep the registry icons unchanged; the existing sidebar rows own interaction.
export function useSidebarIconAnimation() {
  const icons = useRef(new Map<string, IconHandle>())
  const reducedMotion = useReducedMotion()
  return {
    icon: (key: string) => ({
      ref: (handle: IconHandle | null) => {
        if (handle) icons.current.set(key, handle)
        else icons.current.delete(key)
      },
      size: 16,
      className: "size-4 shrink-0",
      "aria-hidden": true as const,
    }),
    row: (key: string, disabled = false) => ({
      onMouseEnter: () => {
        if (!disabled && !reducedMotion) icons.current.get(key)?.startAnimation()
      },
      onMouseLeave: () => icons.current.get(key)?.stopAnimation(),
      onFocus: () => {
        if (!disabled && !reducedMotion) icons.current.get(key)?.startAnimation()
      },
      onBlur: () => icons.current.get(key)?.stopAnimation(),
    }),
  }
}
