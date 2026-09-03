import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { GeneralTableGenerator } from "@/components/workbench/general-table-generator"

beforeEach(() => window.localStorage.clear())
afterEach(cleanup)

describe("GeneralTableGenerator", () => {
  function createAndFillTable() {
    fireEvent.click(screen.getByRole("button", { name: "新建表格" }))
    fireEvent.click(screen.getByRole("button", { name: "创建 2 行 2 列表格" }))
    fireEvent.change(screen.getByRole("textbox", { name: "A1" }), { target: { value: "项目" } })
    fireEvent.change(screen.getByRole("textbox", { name: "B1" }), { target: { value: "结果" } })
    fireEvent.change(screen.getByRole("textbox", { name: "A2" }), { target: { value: "样品 A" } })
    fireEvent.change(screen.getByRole("textbox", { name: "B2" }), { target: { value: "12" } })
  }

  it("previews spreadsheet data and generates a bordered table", () => {
    render(<GeneralTableGenerator />)
    createAndFillTable()

    expect(screen.getByRole("table", { name: "普通表格预览" })).toBeInTheDocument()
    expect(screen.getByLabelText<HTMLInputElement>("生成的 LaTeX 源码").value).toContain("\\hline")
  })

  it("offers natural, page-width and long-table output modes", () => {
    render(<GeneralTableGenerator />)
    createAndFillTable()
    fireEvent.click(screen.getByRole("combobox", { name: "表格类型" }))
    expect(screen.getByRole("option", { name: "普通表格" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "通栏等宽表格" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "跨页表格" })).toBeInTheDocument()
  })

  it("restores table settings and content after leaving the tool", () => {
    const first = render(<GeneralTableGenerator />)
    createAndFillTable()
    fireEvent.click(screen.getByRole("combobox", { name: "表格类型" }))
    const longTableOption = screen.getByRole("option", { name: "跨页表格" })
    fireEvent.pointerDown(longTableOption)
    fireEvent.click(longTableOption)
    expect(screen.getByRole("combobox", { name: "表格类型" })).toHaveTextContent("跨页表格")
    first.unmount()

    render(<GeneralTableGenerator />)
    expect(screen.getByRole("combobox", { name: "表格类型" })).toHaveTextContent("跨页表格")
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "A2" }).value).toBe("样品 A")
    expect(screen.getByLabelText<HTMLInputElement>("生成的 LaTeX 源码").value).toContain("longtable")
  })
})
