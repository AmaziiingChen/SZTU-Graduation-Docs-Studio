import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { SaveStatusBadge } from "./save-status-badge"

afterEach(cleanup)

describe("SaveStatusBadge", () => {
  it("keeps the approved saved-state palette in one business component", () => {
    render(<SaveStatusBadge state="saved" />)

    expect(screen.getByLabelText("保存状态：已保存")).toHaveClass(
      "border-emerald-200",
      "bg-emerald-50",
      "text-emerald-700",
      "dark:border-emerald-800/60",
      "dark:bg-emerald-950/40",
      "dark:text-emerald-300",
    )
  })

  it("uses the default destructive badge treatment for save failures", () => {
    render(<SaveStatusBadge state="error" />)

    expect(screen.getByLabelText("保存状态：保存失败")).toHaveClass(
      "bg-destructive/10",
      "text-destructive",
    )
    expect(screen.getByLabelText("保存状态：保存失败")).not.toHaveClass(
      "bg-emerald-50",
    )
  })

  it("shows an explicit pending label while saving", () => {
    render(<SaveStatusBadge state="saving" />)

    expect(screen.getByLabelText("保存状态：正在保存")).toHaveTextContent(
      "正在保存",
    )
  })
})
