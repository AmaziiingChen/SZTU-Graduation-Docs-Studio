import type { ComponentProps } from "react"

import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

export function FadingScrollArea({
  children,
  className,
  wrapperClassName,
  fadeMode = "mask",
  ...props
}: ComponentProps<typeof ScrollArea> & { wrapperClassName?: string; fadeMode?: "mask" | "overlay" }) {
  return (
    <div className={wrapperClassName}>
      <ScrollArea className={cn(fadeMode === "overlay" ? "editor-scroll-overlay-fade" : "[&_[data-slot=scroll-area-viewport]]:scroll-fade-b", className)} {...props}>
        {children}
      </ScrollArea>
    </div>
  )
}
