import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { ErrorBoundary } from "./error-boundary"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

function dispatchAsyncError(message: string): void {
  act(() => {
    window.dispatchEvent(new ErrorEvent("error", { message }))
  })
}

it("dismisses the async error banner automatically", () => {
  vi.useFakeTimers()
  render(
    <ErrorBoundary>
      <div>content</div>
    </ErrorBoundary>,
  )
  dispatchAsyncError("probe")
  expect(screen.getByText("刚刚遇到一个错误")).toBeInTheDocument()

  act(() => {
    vi.advanceTimersByTime(15_000)
  })
  expect(screen.queryByText("刚刚遇到一个错误")).not.toBeInTheDocument()
})

it("lets the reader close the async error banner", () => {
  render(
    <ErrorBoundary>
      <div>content</div>
    </ErrorBoundary>,
  )
  dispatchAsyncError("probe")
  fireEvent.click(screen.getByRole("button", { name: "关闭错误提示" }))
  expect(screen.queryByText("刚刚遇到一个错误")).not.toBeInTheDocument()
})
