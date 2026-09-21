import { renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useReducedMotion } from "motion/react"
import { useSidebarIconAnimation } from "./use-sidebar-icon-animation"

vi.mock("motion/react", () => ({ useReducedMotion: vi.fn(() => false) }))

describe("sidebar icon interaction", () => {
  it("starts on row hover and keyboard focus, stops on leaving", () => {
    vi.mocked(useReducedMotion).mockReturnValue(false)
    const { result } = renderHook(useSidebarIconAnimation)
    const handle = { startAnimation: vi.fn(), stopAnimation: vi.fn() }
    result.current.icon("document").ref(handle)
    const row = result.current.row("document")
    row.onMouseEnter()
    row.onMouseLeave()
    row.onFocus()
    row.onBlur()
    expect(handle.startAnimation).toHaveBeenCalledTimes(2)
    expect(handle.stopAnimation).toHaveBeenCalledTimes(2)
    result.current.icon("document").ref(null)
    row.onMouseEnter()
    expect(handle.startAnimation).toHaveBeenCalledTimes(2)
  })

  it("does not animate disabled rows or reduced-motion preferences", () => {
    vi.mocked(useReducedMotion).mockReturnValue(false)
    const { result, rerender } = renderHook(useSidebarIconAnimation)
    const handle = { startAnimation: vi.fn(), stopAnimation: vi.fn() }
    result.current.icon("profile").ref(handle)
    result.current.row("profile", true).onMouseEnter()
    result.current.row("profile", true).onFocus()
    vi.mocked(useReducedMotion).mockReturnValue(true)
    rerender()
    result.current.row("profile").onMouseEnter()
    result.current.row("profile").onFocus()
    expect(handle.startAnimation).not.toHaveBeenCalled()
  })
})
