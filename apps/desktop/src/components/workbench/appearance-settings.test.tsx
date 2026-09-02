import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AppearanceSettings } from "./appearance-settings"

const setTheme = vi.fn()

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system", setTheme }),
}))

afterEach(() => {
  cleanup()
  setTheme.mockClear()
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
  })

  it("applies a selected theme through the shared theme provider", () => {
    render(<AppearanceSettings />)

    fireEvent.click(screen.getByRole("button", { name: /深色/ }))

    expect(setTheme).toHaveBeenCalledWith("dark")
  })
})
