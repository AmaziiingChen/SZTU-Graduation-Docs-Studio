import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
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

  it("starts with the data card and keeps guidance and draft actions in its header", async () => {
    render(<GeneralTableGenerator />)

    const main = screen.getByRole("main", { name: "表格生成器" })
    expect(
      within(main).queryByRole("heading", { name: "表格生成器" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/生成普通网格表、通栏表或可跨页表格/)).not.toBeInTheDocument()
    const clearDraft = within(main).getByRole("button", { name: "清空草稿" })
    const cardHeader = clearDraft.closest('[data-slot="card-header"]')
    expect(cardHeader).not.toBeNull()
    expect(clearDraft.closest('[data-slot="card-action"]')).not.toBeNull()
    const guidance = within(cardHeader as HTMLElement).getByRole("button", {
      name: "表格使用说明",
    })
    fireEvent.focus(guidance)
    expect(await screen.findByText(/适合从 Excel、WPS 直接粘贴数据/)).toBeInTheDocument()
  })

  it("previews spreadsheet data and generates a bordered table", () => {
    render(<GeneralTableGenerator />)
    createAndFillTable()

    expect(screen.getByRole("table", { name: "普通表格预览" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "查看 LaTeX" }))
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

  it("groups table structure settings before the table editor", () => {
    render(<GeneralTableGenerator />)

    const settings = screen.getByRole("group", { name: "表格设置" })
    expect(
      within(settings).getByRole("combobox", { name: "表格类型" }),
    ).toBeInTheDocument()
    expect(
      within(settings).getByRole("combobox", { name: "表头行数" }),
    ).toBeInTheDocument()
    expect(
      settings.compareDocumentPosition(
        screen.getByRole("button", { name: "新建表格" }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0)
  })

  it("applies and persists each column alignment in preview and source", () => {
    const first = render(<GeneralTableGenerator />)
    createAndFillTable()
    fireEvent.click(screen.getByRole("combobox", { name: "结果对齐方式" }))
    const rightOption = screen.getByRole("option", { name: "右对齐" })
    fireEvent.pointerDown(rightOption)
    fireEvent.click(rightOption)

    expect(screen.getByRole("columnheader", { name: "结果" })).toHaveClass("text-right")
    fireEvent.click(screen.getByRole("button", { name: "查看 LaTeX" }))
    expect(screen.getByLabelText<HTMLInputElement>("生成的 LaTeX 源码").value).toContain("{|l|r|}")
    first.unmount()

    render(<GeneralTableGenerator />)
    expect(screen.getByRole("combobox", { name: "结果对齐方式" })).toHaveTextContent("右对齐")
    expect(screen.getByRole("columnheader", { name: "结果" })).toHaveClass("text-right")
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
    fireEvent.click(screen.getByRole("button", { name: "查看 LaTeX" }))
    expect(screen.getByLabelText<HTMLInputElement>("生成的 LaTeX 源码").value).toContain("longtable")
  })
})
