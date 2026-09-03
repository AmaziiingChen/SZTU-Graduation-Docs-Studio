import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ThreeLineTableGenerator } from "@/components/workbench/three-line-table-generator"

beforeEach(() => window.localStorage.clear())
afterEach(cleanup)

describe("ThreeLineTableGenerator", () => {
  it("previews pasted spreadsheet data and generates LaTeX", () => {
    render(<ThreeLineTableGenerator />)

    fireEvent.change(screen.getByLabelText("数据"), {
      target: { value: "名称\t数值\n样品 A\t12" },
    })

    expect(screen.getByRole("table", { name: "三线表预览" })).toBeInTheDocument()
    expect(screen.getByLabelText<HTMLInputElement>("生成的 LaTeX 源码").value).toContain("\\toprule")
    expect(screen.getByRole("button", { name: "复制 LaTeX" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "下载 .tex" })).toBeEnabled()
  })

  it("blocks generation when row widths do not match", () => {
    render(<ThreeLineTableGenerator />)
    fireEvent.change(screen.getByLabelText("数据"), {
      target: { value: "名称\t数值\n样品 A" },
    })

    expect(screen.getByText("数据暂时无法生成")).toBeInTheDocument()
    expect(screen.getByText("第 2 行有 1 列，应为 2 列。")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "复制 LaTeX" })).toBeDisabled()
  })

  it("copies generated source to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<ThreeLineTableGenerator />)
    fireEvent.change(screen.getByLabelText("数据"), {
      target: { value: "名称\t数值\n样品 A\t12" },
    })

    fireEvent.click(screen.getByRole("button", { name: "复制 LaTeX" }))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("\\bottomrule"))
  })

  it("restores the local draft after leaving the tool", () => {
    const first = render(<ThreeLineTableGenerator />)
    fireEvent.change(screen.getByLabelText("表题（可选）"), {
      target: { value: "恢复测试" },
    })
    fireEvent.change(screen.getByLabelText("数据"), {
      target: { value: "名称\t数值\n样品 A\t12" },
    })
    first.unmount()

    render(<ThreeLineTableGenerator />)
    expect(screen.getByLabelText<HTMLInputElement>("表题（可选）").value).toBe("恢复测试")
    expect(screen.getByLabelText<HTMLTextAreaElement>("数据").value).toContain("样品 A")
    expect(screen.getByRole("table", { name: "三线表预览" })).toBeInTheDocument()
  })

  it("automatically saves after input settles", () => {
    vi.useFakeTimers()
    try {
      render(<ThreeLineTableGenerator />)
      fireEvent.change(screen.getByLabelText("数据"), {
        target: { value: "名称\t数值\n样品 A\t12" },
      })
      expect(screen.getByLabelText("保存状态：未保存")).toBeInTheDocument()

      act(() => vi.advanceTimersByTime(300))

      expect(screen.getByLabelText("保存状态：已保存")).toBeInTheDocument()
      expect(
        window.localStorage.getItem("sztu-docs.thesis-tools.three-line-table.v1"),
      ).toContain("样品 A")
    } finally {
      vi.useRealTimers()
    }
  })
})
