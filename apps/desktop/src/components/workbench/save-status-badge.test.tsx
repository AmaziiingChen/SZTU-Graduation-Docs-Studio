import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { SaveStatusBadge } from "./save-status-badge"

afterEach(cleanup)

describe("SaveStatusBadge", () => {
  it("keeps the approved saved-state palette in one business component", () => {
    render(<SaveStatusBadge state="saved" />)

    expect(screen.getByLabelText("保存状态：已保存")).toHaveClass(
      "border-transparent",
      "bg-emerald-500",
      "text-white",
    )
  })

  it("uses the default destructive badge treatment for save failures", () => {
    render(<SaveStatusBadge state="error" />)

    expect(screen.getByLabelText("保存状态：保存失败")).toHaveClass(
      "bg-destructive/10",
      "text-destructive",
    )
    expect(screen.getByLabelText("保存状态：保存失败")).not.toHaveClass(
      "bg-emerald-500",
    )
  })

  it("shows an explicit pending label while saving", () => {
    render(<SaveStatusBadge state="saving" />)

    expect(screen.getByLabelText("保存状态：正在保存")).toHaveTextContent(
      "正在保存",
    )
  })

  it("keeps the animated status icon within the compact badge", () => {
    render(<SaveStatusBadge state="saved" />)

    const content = screen
      .getByLabelText("保存状态：已保存")
      .querySelector('[data-slot="save-status-content"]')
    expect(content).toHaveClass("[&>svg]:size-3", "[&>svg]:shrink-0")
  })

  it("renders a quiet footer status without a success fill while preserving failure contrast", () => {
    const { rerender } = render(<SaveStatusBadge state="saved" quiet />)
    const saved = screen.getByLabelText("保存状态：已保存")
    expect(saved).toHaveClass("text-muted-foreground")
    expect(saved).not.toHaveClass("bg-emerald-500")

    rerender(<SaveStatusBadge state="error" quiet />)
    expect(screen.getByLabelText("保存状态：保存失败")).toHaveClass("text-destructive")
  })
})
