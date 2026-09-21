import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { forwardRef, useImperativeHandle } from "react"
import { useReducedMotion } from "motion/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AnimatedActionIcon } from "./animated-action-icon"

vi.mock("motion/react", () => ({ useReducedMotion: vi.fn(() => false) }))
const startAnimation = vi.fn()
const stopAnimation = vi.fn()
const Icon = forwardRef<{ startAnimation: () => void; stopAnimation: () => void }>((_, ref) => {
  useImperativeHandle(ref, () => ({ startAnimation, stopAnimation }))
  return <svg />
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("animated action icons", () => {
  it("plays success feedback once on mount, and respects reduced motion", () => {
    vi.mocked(useReducedMotion).mockReturnValue(false)
    const { rerender, unmount } = render(<AnimatedActionIcon icon={Icon} playOnMount />)
    expect(startAnimation).toHaveBeenCalledOnce()
    rerender(<AnimatedActionIcon icon={Icon} playOnMount />)
    expect(startAnimation).toHaveBeenCalledOnce()
    unmount()
    vi.mocked(useReducedMotion).mockReturnValue(true)
    render(<AnimatedActionIcon icon={Icon} playOnMount />)
    expect(startAnimation).toHaveBeenCalledOnce()
  })

  it("animates from the entire action while preserving its name and click behavior", () => {
    vi.mocked(useReducedMotion).mockReturnValue(false)
    const click = vi.fn()
    render(<button onClick={click}><AnimatedActionIcon icon={Icon} />新增</button>)
    const button = screen.getByRole("button", { name: "新增" })
    fireEvent.mouseEnter(button)
    fireEvent.focus(button)
    expect(startAnimation).toHaveBeenCalledTimes(2)
    fireEvent.mouseLeave(button)
    fireEvent.blur(button)
    expect(stopAnimation).toHaveBeenCalledTimes(2)
    expect(click).not.toHaveBeenCalled()
    fireEvent.click(button)
    expect(click).toHaveBeenCalledOnce()
  })

  it("keeps disabled and reduced-motion menu actions static", () => {
    vi.mocked(useReducedMotion).mockReturnValue(false)
    const { rerender } = render(<button disabled><AnimatedActionIcon icon={Icon} />删除</button>)
    fireEvent.mouseEnter(screen.getByRole("button"))
    expect(startAnimation).not.toHaveBeenCalled()
    vi.mocked(useReducedMotion).mockReturnValue(true)
    rerender(<div role="menuitem" tabIndex={0}><AnimatedActionIcon icon={Icon} />删除</div>)
    fireEvent.mouseEnter(screen.getByRole("menuitem"))
    fireEvent.focus(screen.getByRole("menuitem"))
    expect(startAnimation).not.toHaveBeenCalled()
  })
})
