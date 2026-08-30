import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReferenceImporter } from "./reference-importer"

afterEach(cleanup)

describe("ReferenceImporter", () => {
  it("generates a read-only formatted preview from pasted BibTeX", () => {
    render(
      <ReferenceImporter
        source={'@article{demo, author={张三}, title={合成论文}, journal={合成期刊}, year={2026}}'}
        maximumEntries={50}
        maximumReferenceLength={1000}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText("demo")).toBeInTheDocument()
    expect(
      screen.getByText("[1] 张三. 合成论文[J]. 合成期刊, 2026."),
    ).toBeInTheDocument()
    expect(screen.queryByRole("textbox", { name: "自动排版结果" })).toBeNull()
  })

  it("renders BibTeX title styles and scripts in the read-only preview", () => {
    const { container } = render(
      <ReferenceImporter
        source={String.raw`@article{rich, author={张三}, title={{\textbf{CO}}_{2} 与 \emph{R}^{2} 模型}, journal={合成期刊}, year={2026}}`}
        maximumEntries={50}
        maximumReferenceLength={1000}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText(/\[1\] 张三\./)).toHaveTextContent(
      "[1] 张三. CO2 与 R2 模型[J]. 合成期刊, 2026.",
    )
    expect(container.querySelector("strong")).toHaveTextContent("CO")
    expect(container.querySelector("em")).toHaveTextContent("R")
    expect(container.querySelector("sub")).toHaveTextContent("2")
    expect(container.querySelector("sup")).toHaveTextContent("2")
  })

  it("shows parsed entries while retaining the legacy fallback for invalid BibTeX", () => {
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
    expect(screen.getByText("valid")).toBeInTheDocument()
    expect(
      screen.getByText("[1] 张三. 可用条目[J]. 合成期刊, 2026."),
    ).toBeInTheDocument()
    expect(screen.queryByText("[1] 已保存的有效文献[J].")).not.toBeInTheDocument()
    expect(screen.getByText(/不会被错误输入覆盖/)).toBeInTheDocument()
  })

  it("emits the complete source for autosave", () => {
    const onChange = vi.fn()
    render(
      <ReferenceImporter
        source=""
        maximumEntries={50}
        maximumReferenceLength={1000}
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByRole("textbox", { name: "参考文献 BibTeX" }), {
      target: { value: "@book{demo, title={书名}, year={2026}}" },
    })
    expect(onChange).toHaveBeenCalledWith(
      "@book{demo, title={书名}, year={2026}}",
    )
  })

  it("adds one blank line between complete pasted BibTeX entries", () => {
    const onChange = vi.fn()
    const first =
      "@article{first, author={张三}, title={第一篇}, journal={合成期刊}, year={2025}}"
    const second =
      "@article{second, author={李四}, title={第二篇}, journal={合成期刊}, year={2026}}"
    render(
      <ReferenceImporter
        source=""
        maximumEntries={50}
        maximumReferenceLength={1000}
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByRole("textbox", { name: "参考文献 BibTeX" }), {
      target: { value: `${first}\n${second}` },
    })

    expect(onChange).toHaveBeenCalledWith(`${first}\n\n${second}`)
  })
})
