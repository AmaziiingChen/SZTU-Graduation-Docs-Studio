import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ThreeLineTableGenerator } from "@/components/workbench/three-line-table-generator"

beforeEach(() => window.localStorage.clear())
afterEach(cleanup)

describe("ThreeLineTableGenerator", () => {
  function createTable() {
    fireEvent.click(screen.getByRole("button", { name: "新建表格" }))
    fireEvent.click(screen.getByRole("button", { name: "创建 2 行 2 列表格" }))
  }

  function fillTable() {
    createTable()
    fireEvent.change(screen.getByRole("textbox", { name: "A1" }), { target: { value: "名称" } })
    fireEvent.change(screen.getByRole("textbox", { name: "B1" }), { target: { value: "数值" } })
    fireEvent.change(screen.getByRole("textbox", { name: "A2" }), { target: { value: "样品 A" } })
    fireEvent.change(screen.getByRole("textbox", { name: "B2" }), { target: { value: "12" } })
  }

  it("starts with the data card and keeps guidance and draft actions in its header", async () => {
    render(<ThreeLineTableGenerator />)

    const main = screen.getByRole("main", { name: "三线表生成器" })
    expect(
      within(main).queryByRole("heading", { name: "三线表生成器" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/粘贴 Excel、WPS 表格或 CSV 数据/)).not.toBeInTheDocument()
    const clearDraft = within(main).getByRole("button", { name: "清空草稿" })
    const cardHeader = clearDraft.closest('[data-slot="card-header"]')
    expect(cardHeader).not.toBeNull()
    expect(clearDraft.closest('[data-slot="card-action"]')).not.toBeNull()
    const guidance = within(cardHeader as HTMLElement).getByRole("button", {
      name: "三线表使用说明",
    })
    fireEvent.focus(guidance)
    expect(await screen.findByText(/生成三线表的 LaTeX 代码/)).toBeInTheDocument()
  })

  it("previews visually edited spreadsheet data and shows LaTeX in a sheet", () => {
    render(<ThreeLineTableGenerator />)
    fillTable()

    expect(screen.getByRole("table", { name: "三线表预览" })).toBeInTheDocument()
    expect(screen.queryByLabelText("生成的 LaTeX 源码")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "复制源码" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "下载源码" })).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: "查看 LaTeX" }))
    expect(screen.getByLabelText<HTMLInputElement>("生成的 LaTeX 源码").value).toContain("\\toprule")
  })

  it("blocks generation while the header is blank", () => {
    render(<ThreeLineTableGenerator />)
    createTable()
    fireEvent.change(screen.getByRole("textbox", { name: "A2" }), { target: { value: "样品 A" } })
    fireEvent.change(screen.getByRole("textbox", { name: "B2" }), { target: { value: "12" } })

    expect(screen.getByText("数据暂时无法生成")).toBeInTheDocument()
    expect(screen.getByText("表头中不能有空白单元格。")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "查看 LaTeX" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "复制 PNG" })).toBeDisabled()
  })

  it("copies generated source to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<ThreeLineTableGenerator />)
    fillTable()

    fireEvent.click(screen.getByRole("button", { name: "复制源码" }))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("\\bottomrule"))
  })

  it("restores the local draft after leaving the tool", () => {
    const first = render(<ThreeLineTableGenerator />)
    fireEvent.change(screen.getByLabelText("表题（可选）"), {
      target: { value: "恢复测试" },
    })
    fillTable()
    first.unmount()

    render(<ThreeLineTableGenerator />)
    expect(screen.getByLabelText<HTMLInputElement>("表题（可选）").value).toBe("恢复测试")
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "A2" }).value).toBe("样品 A")
    expect(screen.getByRole("table", { name: "三线表预览" })).toBeInTheDocument()
  })

  it("automatically saves after input settles", () => {
    vi.useFakeTimers()
    try {
      const onSaveStateChange = vi.fn()
      render(<ThreeLineTableGenerator onSaveStateChange={onSaveStateChange} />)
      fillTable()
      expect(onSaveStateChange).toHaveBeenLastCalledWith("dirty")
      expect(screen.queryByLabelText("保存状态：未保存")).not.toBeInTheDocument()

      act(() => vi.advanceTimersByTime(300))

      expect(onSaveStateChange).toHaveBeenLastCalledWith("saved")
      expect(
        window.localStorage.getItem("sztu-docs.thesis-tools.three-line-table.v1"),
      ).toContain("样品 A")
    } finally {
      vi.useRealTimers()
    }
  })
})
