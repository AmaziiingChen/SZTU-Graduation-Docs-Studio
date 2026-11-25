import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ErrorBoundary } from "./error-boundary"

function Boom(): never {
  throw new Error("render exploded")
}

describe("ErrorBoundary", () => {
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it("shows a recoverable fallback with a diagnostic id", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByText("页面遇到了一个问题")).toBeInTheDocument()
    expect(screen.getByText(/诊断编号/)).toBeInTheDocument()
    expect(screen.getByText(/render exploded/)).toBeInTheDocument()
  })

  it("can switch to safe mode after a crash", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )

    fireEvent.click(screen.getByRole("button", { name: "进入安全模式" }))
    expect(window.localStorage.getItem("sztu-docs.safe-mode")).toBe("1")
  })
})
