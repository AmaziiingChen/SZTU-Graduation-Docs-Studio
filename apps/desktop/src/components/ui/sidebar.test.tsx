import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import {
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"

afterEach(cleanup)

function SidebarState() {
  const { state } = useSidebar()
  return <output aria-label="侧边栏状态">{state}</output>
}

function SidebarHarness() {
  return (
    <SidebarProvider>
      <SidebarState />
      <SidebarTrigger aria-label="折叠侧边栏" />
    </SidebarProvider>
  )
}

describe("SidebarProvider", () => {
  it("does not reserve Command+B or Ctrl+B for the sidebar", () => {
    render(<SidebarHarness />)

    expect(screen.getByLabelText("侧边栏状态")).toHaveTextContent("expanded")

    expect(
      fireEvent.keyDown(window, { key: "b", code: "KeyB", metaKey: true }),
    ).toBe(true)
    expect(screen.getByLabelText("侧边栏状态")).toHaveTextContent("expanded")

    expect(
      fireEvent.keyDown(window, { key: "b", code: "KeyB", ctrlKey: true }),
    ).toBe(true)
    expect(screen.getByLabelText("侧边栏状态")).toHaveTextContent("expanded")
  })

  it("still toggles the sidebar from its visible button", () => {
    render(<SidebarHarness />)

    fireEvent.click(screen.getByRole("button", { name: "折叠侧边栏" }))

    expect(screen.getByLabelText("侧边栏状态")).toHaveTextContent("collapsed")
  })
})
