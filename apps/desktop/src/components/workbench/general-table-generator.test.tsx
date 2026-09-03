import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { GeneralTableGenerator } from "@/components/workbench/general-table-generator"

beforeEach(() => window.localStorage.clear())
afterEach(cleanup)

describe("GeneralTableGenerator", () => {
  it("previews spreadsheet data and generates a bordered table", () => {
    render(<GeneralTableGenerator />)
    fireEvent.change(screen.getByLabelText("数据"), {
      target: { value: "项目\t结果\n样品 A\t12" },
    })

    expect(screen.getByRole("table", { name: "普通表格预览" })).toBeInTheDocument()
    expect(screen.getByLabelText<HTMLInputElement>("生成的 LaTeX 源码").value).toContain("\\hline")
  })

  it("offers natural, page-width and long-table output modes", () => {
    render(<GeneralTableGenerator />)
    fireEvent.change(screen.getByLabelText("数据"), {
      target: { value: "项目\t结果\n样品 A\t12" },
    })
    fireEvent.click(screen.getByRole("combobox", { name: "表格类型" }))
    expect(screen.getByRole("option", { name: "普通表格" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "通栏等宽表格" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "跨页表格" })).toBeInTheDocument()
  })

  it("restores table settings and content after leaving the tool", () => {
    const first = render(<GeneralTableGenerator />)
    fireEvent.change(screen.getByLabelText("数据"), {
      target: { value: "项目\t结果\n样品 A\t12" },
    })
    fireEvent.click(screen.getByRole("combobox", { name: "表格类型" }))
    const longTableOption = screen.getByRole("option", { name: "跨页表格" })
    fireEvent.pointerDown(longTableOption)
    fireEvent.click(longTableOption)
    expect(screen.getByRole("combobox", { name: "表格类型" })).toHaveTextContent("跨页表格")
    first.unmount()

    render(<GeneralTableGenerator />)
    expect(screen.getByRole("combobox", { name: "表格类型" })).toHaveTextContent("跨页表格")
    expect(screen.getByLabelText<HTMLTextAreaElement>("数据").value).toContain("样品 A")
    expect(screen.getByLabelText<HTMLInputElement>("生成的 LaTeX 源码").value).toContain("longtable")
  })
})
