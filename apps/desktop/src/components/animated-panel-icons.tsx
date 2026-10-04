import { forwardRef, useImperativeHandle, useState } from "react"
import { PanelLeftClose } from "@/components/animate-ui/icons/panel-left-close"
import { PanelLeftOpen } from "@/components/animate-ui/icons/panel-left-open"

type Handle = { startAnimation: () => void; stopAnimation: () => void }
type Props = { size?: number; className?: string }

// Only bridge the official controlled trigger to the existing action adapter.
const PanelIcon = forwardRef<Handle, Props & { expanded: boolean }>(
  function PanelIcon({ expanded, size = 16, className }, ref) {
    const [active, setActive] = useState(false)
    useImperativeHandle(ref, () => ({
      startAnimation: () => setActive(true),
      stopAnimation: () => setActive(false),
    }), [])
    const Icon = expanded ? PanelLeftClose : PanelLeftOpen
    return <Icon size={size} className={className} animate={active} />
  },
)
export const AnimatedPanelLeftCloseIcon = forwardRef<Handle, Props>(
  function AnimatedPanelLeftCloseIcon(props, ref) {
    return <PanelIcon {...props} expanded ref={ref} />
  },
)
export const AnimatedPanelLeftOpenIcon = forwardRef<Handle, Props>(
  function AnimatedPanelLeftOpenIcon(props, ref) {
    return <PanelIcon {...props} expanded={false} ref={ref} />
  },
)
