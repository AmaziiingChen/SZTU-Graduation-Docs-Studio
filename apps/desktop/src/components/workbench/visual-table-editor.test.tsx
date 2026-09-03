import { useState } from "react"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { VisualTableEditor, type EditableTableValue } from "@/components/workbench/visual-table-editor"

const exampleData = "项目\t结果\n样品 A\t12"

afterEach(cleanup)

function ControlledEditor() {
  const [value, setValue] = useState<EditableTableValue>({ source: "" })
  return <VisualTableEditor value={value} onChange={setValue} exampleData={exampleData} />
}

describe("VisualTableEditor", () => {
  it("creates a table from the hovered row and column picker", () => {
    render(<ControlledEditor />)
    fireEvent.click(screen.getByRole("button", { name: "新建表格" }))
    fireEvent.pointerEnter(screen.getByRole("button", { name: "创建 4 行 5 列表格" }))
    expect(screen.getByText("4 行 × 5 列")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "创建 4 行 5 列表格" }))

    expect(screen.getAllByRole("gridcell")).toHaveLength(20)
    expect(screen.getByRole("textbox", { name: "E4" })).toBeInTheDocument()
  })

  it("moves between cells with Tab and Enter", async () => {
    render(<ControlledEditor />)
    fireEvent.click(screen.getByRole("button", { name: "新建表格" }))
    fireEvent.click(screen.getByRole("button", { name: "创建 2 行 2 列表格" }))

    const first = screen.getByRole("textbox", { name: "A1" })
    first.focus()
    fireEvent.keyDown(first, { key: "Tab" })
    await waitFor(() => expect(screen.getByRole("textbox", { name: "B1" })).toHaveFocus())
    fireEvent.keyDown(screen.getByRole("textbox", { name: "B1" }), { key: "Enter" })
    await waitFor(() => expect(screen.getByRole("textbox", { name: "B2" })).toHaveFocus())
  })

  it("pastes an Excel block into the selected cell", () => {
    render(<ControlledEditor />)
    fireEvent.click(screen.getByRole("button", { name: "新建表格" }))
    fireEvent.click(screen.getByRole("button", { name: "创建 2 行 2 列表格" }))

    fireEvent.paste(screen.getByRole("textbox", { name: "A1" }), {
      clipboardData: { getData: vi.fn(() => exampleData) },
    })

    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "A1" }).value).toBe("项目")
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "B2" }).value).toBe("12")
  })

  it("inserts and deletes the active row", () => {
    render(<ControlledEditor />)
    fireEvent.click(screen.getByRole("button", { name: "新建表格" }))
    fireEvent.click(screen.getByRole("button", { name: "创建 2 行 2 列表格" }))
    fireEvent.focus(screen.getByRole("textbox", { name: "A1" }))

    fireEvent.click(screen.getByRole("button", { name: "插入行" }))
    expect(screen.getAllByRole("gridcell")).toHaveLength(6)
    fireEvent.click(screen.getByRole("button", { name: "删除行" }))
    expect(screen.getAllByRole("gridcell")).toHaveLength(4)
  })
})
