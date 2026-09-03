import { useEffect, useRef, useState, type ComponentProps } from "react"

import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

export function FadingScrollArea({
  children,
  className,
  wrapperClassName,
  ...props
}: ComponentProps<typeof ScrollArea> & { wrapperClassName?: string }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [hasContentBelow, setHasContentBelow] = useState(false)

  useEffect(() => {
    const viewport = rootRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    )
    if (!viewport) return

    const updateFade = () => {
      setHasContentBelow(
        viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 1,
      )
    }
    updateFade()
    viewport.addEventListener("scroll", updateFade, { passive: true })

    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateFade)
    resizeObserver?.observe(viewport)
    if (viewport.firstElementChild instanceof HTMLElement) {
      resizeObserver?.observe(viewport.firstElementChild)
    }

    return () => {
      viewport.removeEventListener("scroll", updateFade)
      resizeObserver?.disconnect()
    }
  }, [])

  return (
    <div className={cn("relative", wrapperClassName)}>
      <ScrollArea ref={rootRef} className={className} {...props}>
        {children}
      </ScrollArea>
      {/* Functional edge fade shared by long-form content panes. */}
      <div
        data-slot="scroll-bottom-fade"
        data-visible={hasContentBelow}
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute right-2.5 bottom-0 left-0 h-8 bg-linear-to-b from-transparent to-background transition-opacity duration-150 motion-reduce:transition-none",
          hasContentBelow ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  )
}
