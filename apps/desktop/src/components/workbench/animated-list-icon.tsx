import { forwardRef, useImperativeHandle, useState } from "react"
import { List } from "@/components/animate-ui/icons/list"

// Bridge Animate UI's controlled trigger to the workbench's existing action adapter.
// The icon paths, timing and motion remain the official List implementation.
export const AnimatedListIcon = forwardRef<
  { startAnimation: () => void; stopAnimation: () => void },
  { size?: number; className?: string }
>(function AnimatedListIcon({ size = 16, className }, ref) {
  const [active, setActive] = useState(false)
  useImperativeHandle(ref, () => ({
    startAnimation: () => setActive(true),
    stopAnimation: () => setActive(false),
  }), [])
  return <List size={size} className={className} animate={active} />
})
