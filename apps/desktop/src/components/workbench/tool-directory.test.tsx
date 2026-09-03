import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ToolDirectory } from "./tool-directory"

afterEach(cleanup)

describe("ToolDirectory", () => {
  it("keeps cards still and limits directional feedback to the open button", () => {
    const { container } = render(<ToolDirectory onOpenTool={vi.fn()} />)

    expect(container.querySelector('[data-slot="card"]')).not.toHaveClass(
      "hover:-translate-y-0.5",
      "focus-within:-translate-y-0.5",
    )
    const button = screen.getByRole("button", { name: "打开 Xmind" })
    expect(button).toHaveClass("group/tool-open")
    const externalIcon = button.querySelector("svg")
    expect(externalIcon).not.toHaveClass(
      "group-hover/tool-open:translate-x-0.5",
      "group-hover/tool-open:-translate-y-0.5",
    )
    expect(
      externalIcon?.querySelectorAll('[data-slot="tool-open-arrow"]'),
    ).toHaveLength(2)
  })

  it("shows an opening state until the external action completes", async () => {
    let finishOpening: (() => void) | undefined
    const onOpenTool = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishOpening = resolve
        }),
    )
    render(<ToolDirectory onOpenTool={onOpenTool} />)

    fireEvent.click(screen.getByRole("button", { name: "打开 Xmind" }))

    expect(onOpenTool).toHaveBeenCalledWith("xmind")
    expect(screen.getByRole("button", { name: "正在打开 Xmind" })).toBeDisabled()
    expect(
      screen
        .getByRole("button", { name: "正在打开 Xmind" })
        .querySelector('[data-slot="tool-open-icon"]'),
    ).toHaveAttribute("data-state", "opening")

    finishOpening?.()
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "打开 Xmind" })).toBeEnabled(),
    )
  })
})
