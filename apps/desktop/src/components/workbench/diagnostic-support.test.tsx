import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { DiagnosticSupport } from "./diagnostic-support"
import { writeClipboardText } from "@/lib/desktop-clipboard"

vi.mock("@/lib/desktop-clipboard", () => ({ writeClipboardText: vi.fn() }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

it("copies the diagnostic case id through the desktop clipboard", async () => {
  vi.mocked(writeClipboardText).mockResolvedValueOnce(undefined)
  render(<DiagnosticSupport caseId="renderer-abc123" />)

  fireEvent.click(screen.getByRole("button", { name: "复制编号" }))

  await waitFor(() => expect(writeClipboardText).toHaveBeenCalledWith("renderer-abc123"))
  expect(await screen.findByRole("button", { name: "已复制" })).toBeInTheDocument()
})
