import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReferenceImporter } from "./reference-importer"

afterEach(cleanup)

const first =
  "@article{first, author={张三}, title={第一篇}, journal={合成期刊}, year={2025}}"
const second =
  "@article{second, author={李四}, title={第二篇}, journal={合成期刊}, year={2026}}"

function renderImporter(source = "", onChange = vi.fn()) {
  return {
    onChange,
    ...render(
      <ReferenceImporter
        source={source}
        maximumEntries={50}
        maximumReferenceLength={1000}
        onChange={onChange}
      />,
    ),
  }
}

describe("ReferenceImporter", () => {
  it("renders each parsed reference as a collapsed formatted item", () => {
    renderImporter(
      "@article{demo, author={张三}, title={合成论文}, journal={合成期刊}, year={2026}}",
    )

    expect(screen.getByText("1 条")).toBeInTheDocument()
    expect(
      screen.getByText("[1] 张三. 合成论文[J]. 合成期刊, 2026."),
    ).toBeInTheDocument()
    expect(screen.queryByText("@article{demo")).not.toBeInTheDocument()
  })

  it("renders BibTeX title styles and scripts in the collapsed preview", () => {
    const { container } = renderImporter(
      String.raw`@article{rich, author={张三}, title={{\textbf{CO}}_{2} 与 \emph{R}^{2} 模型}, journal={合成期刊}, year={2026}}`,
    )

    expect(screen.getByText(/\[1\] 张三\./)).toHaveTextContent(
      "[1] 张三. CO2 与 R2 模型[J]. 合成期刊, 2026.",
    )
    expect(container.querySelector("strong")).toHaveTextContent("CO")
    expect(container.querySelector("em")).toHaveTextContent("R")
    expect(container.querySelector("sub")).toHaveTextContent("2")
    expect(container.querySelector("sup")).toHaveTextContent("2")
  })

  it("shows valid parsed entries while retaining the last valid legacy fallback", () => {
    render(
      <ReferenceImporter
        source={
          '@article{valid, author={张三}, title={可用条目}, journal={合成期刊}, year={2026}}\n@article{broken, title={缺少字段}}'
        }
        legacyReferences={["[1] 已保存的有效文献[J]."]}
        maximumEntries={50}
        maximumReferenceLength={1000}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText("BibTeX 尚未通过检查")).toBeInTheDocument()
    expect(
      screen.getByText("[1] 张三. 可用条目[J]. 合成期刊, 2026."),
    ).toBeInTheDocument()
    expect(screen.queryByText("[1] 已保存的有效文献[J].")).not.toBeInTheDocument()
    expect(screen.getByText(/不会被错误输入覆盖/)).toBeInTheDocument()
  })

  it("adds one complete entry from the focused entry dialog", () => {
    const { onChange } = renderImporter()

    fireEvent.click(screen.getByRole("button", { name: "添加第一条参考文献" }))
    fireEvent.change(screen.getByRole("textbox", { name: "单条参考文献 BibTeX" }), {
      target: { value: "@book{demo, title={书名}, year={2026}}" },
    })
    fireEvent.click(screen.getByRole("button", { name: "完成" }))

    expect(onChange).toHaveBeenCalledWith(
      "@book{demo, title={书名}, year={2026}}",
    )
  })

  it("appends and separates multiple entries through batch paste", () => {
    const { onChange } = renderImporter(first)

    fireEvent.click(screen.getByRole("button", { name: "批量粘贴 BibTeX" }))
    fireEvent.change(screen.getByRole("textbox", { name: "批量参考文献 BibTeX" }), {
      target: { value: second },
    })
    fireEvent.click(screen.getByRole("button", { name: "添加这些条目" }))

    expect(onChange).toHaveBeenCalledWith(`${first}\n\n${second}`)
  })

  it("moves entries with accessible up and down controls", () => {
    const { onChange } = renderImporter(`${first}\n\n${second}`)

    fireEvent.click(screen.getByRole("button", { name: /\[1\].*第一篇/ }))
    fireEvent.click(screen.getByRole("button", { name: "下移 first" }))

    expect(onChange).toHaveBeenCalledWith(`${second}\n\n${first}`)
  })

  it("keeps macros in advanced source mode and disables lossy item edits", () => {
    const source = `@string{journalName = {合成期刊}}\n\n@article{macro, author={张三}, title={宏测试}, journal=journalName, year={2026}}`
    const { onChange } = renderImporter(source)

    expect(screen.getByText("当前文献包含宏、注释或其他高级源码")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /\[1\].*宏测试/ }))
    expect(screen.getByRole("button", { name: "编辑 macro" })).toBeDisabled()

    fireEvent.click(screen.getByRole("button", { name: "高级源码" }))
    const editor = screen.getByRole("textbox", { name: "参考文献高级 BibTeX 源码" })
    expect(editor).toHaveValue(source)
    fireEvent.click(screen.getByRole("button", { name: "保存源码" }))
    expect(onChange).toHaveBeenCalledWith(source)
  })
})
