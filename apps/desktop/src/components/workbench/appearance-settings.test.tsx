import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AppearanceSettings } from "./appearance-settings"

const setTheme = vi.fn()
const originalTransition = Object.getOwnPropertyDescriptor(document, "startViewTransition")
const originalAnimate = Object.getOwnPropertyDescriptor(document.documentElement, "animate")
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia")!

function installTransition(ready = Promise.resolve(), updateImmediately = true) {
  const skipTransition = vi.fn()
  const start = vi.fn((update: () => void) => {
    if (updateImmediately) update()
    return { ready, finished: Promise.resolve(), skipTransition }
  })
  const animate = vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn() }))
  Object.defineProperty(document, "startViewTransition", { configurable: true, value: start })
  Object.defineProperty(document.documentElement, "animate", { configurable: true, value: animate })
  return { start, animate, skipTransition }
}

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system", setTheme }),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Object.defineProperty(window, "matchMedia", originalMatchMedia)
  if (originalTransition) Object.defineProperty(document, "startViewTransition", originalTransition)
  else Reflect.deleteProperty(document, "startViewTransition")
  if (originalAnimate) Object.defineProperty(document.documentElement, "animate", originalAnimate)
  else Reflect.deleteProperty(document.documentElement, "animate")
  setTheme.mockClear()
  window.localStorage.clear()
  delete document.documentElement.dataset.themePreset
  delete document.documentElement.dataset.themeTransition
  document.documentElement.classList.remove("dark")
})

describe("AppearanceSettings", () => {
  it("offers the supported application themes and marks the current choice", () => {
    render(<AppearanceSettings />)

    expect(screen.getByRole("button", { name: /跟随系统/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    expect(screen.getByRole("button", { name: /浅色/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    )
    expect(screen.getByRole("button", { name: /深色/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    )
    expect(screen.getByRole("button", { name: /Notion/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    expect(screen.getByRole("button", { name: /shadcn/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /GitHub/ })).toBeInTheDocument()
  })

  it("applies a selected theme through the shared theme provider", () => {
    render(<AppearanceSettings />)

    fireEvent.click(screen.getByRole("button", { name: /深色/ }))

    expect(setTheme).toHaveBeenCalledWith("dark")
  })

  it("applies and persists an approved named theme preset", () => {
    render(<AppearanceSettings />)

    fireEvent.click(screen.getByRole("button", { name: /GitHub/ }))

    expect(setTheme).not.toHaveBeenCalled()
    expect(document.documentElement.dataset.themePreset).toBe("github")
    expect(window.localStorage.getItem("sztu-workbench-appearance-preset")).toBe(
      "github",
    )
  })

  it("wipes the new theme across the root snapshot while preserving provider updates", async () => {
    const { start, animate } = installTransition()
    render(<AppearanceSettings />)
    fireEvent.click(screen.getByRole("button", { name: /深色/ }))
    expect(start).toHaveBeenCalledOnce()
    expect(setTheme).toHaveBeenCalledWith("dark")
    await waitFor(() => expect(animate).toHaveBeenCalledWith(
      { clipPath: ["inset(0 100% 0 0)", "inset(0 0 0 0)"] },
      { duration: 700, easing: "ease-in-out", pseudoElement: "::view-transition-new(root)" },
    ))
    await waitFor(() => expect(document.documentElement).not.toHaveAttribute("data-theme-transition"))
  })

  it("does not animate an unchanged resolved appearance", () => {
    const { start } = installTransition()
    render(<AppearanceSettings />)
    fireEvent.click(screen.getByRole("button", { name: /浅色/ }))
    expect(start).not.toHaveBeenCalled()
    expect(setTheme).toHaveBeenCalledWith("light")
  })

  it("uses an immediate change when reduced motion is enabled", () => {
    const queryResult = window.matchMedia("(prefers-reduced-motion: reduce)")
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn((query: string) => ({
      ...queryResult, media: query, matches: query === "(prefers-reduced-motion: reduce)",
    })) })
    const { start } = installTransition()
    render(<AppearanceSettings />)
    fireEvent.click(screen.getByRole("button", { name: /深色/ }))
    expect(start).not.toHaveBeenCalled()
    expect(setTheme).toHaveBeenCalledWith("dark")
  })

  it("keeps the latest choice when a skipped snapshot invokes its old update later", async () => {
    let resolveReady!: () => void
    const ready = new Promise<void>(resolve => { resolveReady = resolve })
    const { start, animate, skipTransition } = installTransition(ready, false)
    render(<AppearanceSettings />)
    fireEvent.click(screen.getByRole("button", { name: /深色/ }))
    fireEvent.click(screen.getByRole("button", { name: /浅色/ }))
    expect(skipTransition).toHaveBeenCalledOnce()
    await act(async () => { start.mock.calls[0][0](); resolveReady() })
    expect(setTheme.mock.calls.every(([value]) => value === "light")).toBe(true)
    expect(animate).not.toHaveBeenCalled()
    expect(document.documentElement).not.toHaveAttribute("data-theme-transition")
  })

  it("still changes the theme when snapshot creation rejects", async () => {
    const { skipTransition, animate } = installTransition(Promise.reject(new DOMException("Hidden document", "InvalidStateError")), false)
    render(<AppearanceSettings />)
    fireEvent.click(screen.getByRole("button", { name: /深色/ }))
    await waitFor(() => expect(setTheme).toHaveBeenCalledWith("dark"))
    expect(skipTransition).toHaveBeenCalledOnce()
    expect(animate).not.toHaveBeenCalled()
    expect(document.documentElement).not.toHaveAttribute("data-theme-transition")
  })

  it("cleans up snapshots on navigation while allowing the selected theme to commit", async () => {
    let resolveReady!: () => void
    const ready = new Promise<void>(resolve => { resolveReady = resolve })
    const { start, animate, skipTransition } = installTransition(ready, false)
    const { unmount } = render(<AppearanceSettings />)
    fireEvent.click(screen.getByRole("button", { name: /深色/ }))
    unmount()
    await act(async () => { start.mock.calls[0][0](); resolveReady() })
    expect(skipTransition).toHaveBeenCalled()
    expect(setTheme).toHaveBeenCalledWith("dark")
    expect(animate).not.toHaveBeenCalled()
    expect(document.documentElement).not.toHaveAttribute("data-theme-transition")
  })
})
