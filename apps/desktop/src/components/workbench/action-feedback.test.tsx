import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { LatexSourceCard } from "./latex-source-card"
import { SectionCompletionMark } from "./section-completion-mark"
import { TooltipProvider } from "@/components/ui/tooltip"
import { writeClipboardText } from "@/lib/desktop-clipboard"
import { toast } from "sonner"
vi.mock("@/lib/desktop-clipboard", () => ({ writeClipboardText: vi.fn() }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks() })

it("waits for clipboard success, restarts its receipt, and restores the original icon", async () => {
  vi.useFakeTimers()
  let resolve!: () => void
  vi.mocked(writeClipboardText).mockImplementationOnce(() => new Promise<void>((done) => { resolve = done }))
  const { container } = render(<LatexSourceCard latex="example" filename="example.tex" />)
  const button = screen.getByRole("button", { name: "复制 LaTeX" })
  fireEvent.click(button)
  expect(container.querySelector('[data-slot="action-success"]')).toBeNull()
  await act(async () => resolve())
  expect(container.querySelector('[data-slot="action-success"]')).not.toBeNull()
  act(() => vi.advanceTimersByTime(1000))
  vi.mocked(writeClipboardText).mockResolvedValueOnce(undefined)
  await act(async () => fireEvent.click(button))
  act(() => vi.advanceTimersByTime(1000))
  expect(container.querySelector('[data-slot="action-success"]')).not.toBeNull()
  act(() => vi.advanceTimersByTime(800))
  expect(container.querySelector('[data-slot="action-success"]')).toBeNull()
  expect(button).toHaveAccessibleName("复制 LaTeX")
})

it("shows only the error when copying fails", async () => {
  vi.mocked(writeClipboardText).mockRejectedValueOnce(new Error("denied"))
  const { container } = render(<LatexSourceCard latex="example" filename="example.tex" />)
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "复制 LaTeX" })))
  expect(container.querySelector('[data-slot="action-success"]')).toBeNull()
  expect(toast.success).not.toHaveBeenCalled()
  expect(toast.error).toHaveBeenCalledOnce()
})

it("draws section completion only on the first completion in this document view", () => {
  vi.useFakeTimers()
  const mark = (state: "incomplete" | "complete") => <TooltipProvider><SectionCompletionMark state={state} /></TooltipProvider>
  const { container, rerender } = render(mark("incomplete"))
  rerender(mark("complete"))
  expect(container.querySelector('[data-animate="true"]')).not.toBeNull()
  act(() => vi.advanceTimersByTime(350))
  rerender(mark("incomplete"))
  rerender(mark("complete"))
  expect(container.querySelector('[data-animate="true"]')).toBeNull()
})
