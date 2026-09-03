import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MultiFigureGenerator } from "@/components/workbench/multi-figure-generator"
import { clearMultiFigureSessionImages } from "@/lib/multi-figure-session"

afterEach(() => {
  cleanup()
  clearMultiFigureSessionImages()
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

describe("MultiFigureGenerator", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
      revokeObjectURL: vi.fn(),
    })
  })

  it("previews selected images and generates subfigure source", () => {
    render(<MultiFigureGenerator />)
    const files = [
      new File(["a"], "a.png", { type: "image/png" }),
      new File(["b"], "b.png", { type: "image/png" }),
    ]
    fireEvent.change(screen.getByLabelText("选择图片"), { target: { files } })
    fireEvent.change(screen.getByLabelText("图片 1 子标题"), { target: { value: "样品 A" } })

    expect(screen.getByRole("img", { name: "图片 1 预览" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "查看 LaTeX" }))
    expect(screen.getByLabelText<HTMLInputElement>("生成的 LaTeX 源码").value).toContain("\\begin{subfigure}")
    expect(screen.getByText(/\\usepackage\{subcaption\}/)).toBeInTheDocument()
  })

  it("supports changing image order", () => {
    render(<MultiFigureGenerator />)
    const files = [
      new File(["a"], "a.png", { type: "image/png" }),
      new File(["b"], "b.png", { type: "image/png" }),
    ]
    fireEvent.change(screen.getByLabelText("选择图片"), { target: { files } })
    fireEvent.click(screen.getByRole("button", { name: "下移图片 1" }))

    fireEvent.click(screen.getByRole("button", { name: "查看 LaTeX" }))
    const source = screen.getByLabelText<HTMLInputElement>("生成的 LaTeX 源码").value
    expect(source.indexOf("b.png")).toBeLessThan(source.indexOf("a.png"))
  })

  it("keeps selected images available while switching tools", () => {
    const first = render(<MultiFigureGenerator />)
    const files = [new File(["a"], "a.png", { type: "image/png" })]
    fireEvent.change(screen.getByLabelText("选择图片"), { target: { files } })
    fireEvent.change(screen.getByLabelText("图片 1 子标题"), { target: { value: "样品 A" } })
    first.unmount()

    render(<MultiFigureGenerator />)
    expect(screen.getByRole("img", { name: "图片 1 预览" })).toBeInTheDocument()
    expect(screen.getByLabelText<HTMLInputElement>("图片 1 子标题").value).toBe("样品 A")
  })

  it("edits one selected subfigure caption instead of rendering an input for every image", () => {
    render(<MultiFigureGenerator />)
    const files = [
      new File(["a"], "a.png", { type: "image/png" }),
      new File(["b"], "b.png", { type: "image/png" }),
    ]
    fireEvent.change(screen.getByLabelText("选择图片"), { target: { files } })

    expect(screen.queryByLabelText("图片 2 子标题")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "选择图片 2 进行编辑" }))
    fireEvent.change(screen.getByLabelText("图片 2 子标题"), { target: { value: "样品 B" } })
    expect(screen.getByText("（b）样品 B")).toBeInTheDocument()
  })

  it("restores layout metadata after an application restart", () => {
    const first = render(<MultiFigureGenerator />)
    const files = [new File(["a"], "a.png", { type: "image/png" })]
    fireEvent.change(screen.getByLabelText("选择图片"), { target: { files } })
    fireEvent.change(screen.getByLabelText("整组图题（可选）"), { target: { value: "实验结果" } })
    first.unmount()
    clearMultiFigureSessionImages()

    render(<MultiFigureGenerator />)
    expect(screen.getByLabelText<HTMLInputElement>("整组图题（可选）").value).toBe("实验结果")
    expect(screen.getByText("上次的布局和 1 张图片标题已保留。")).toBeInTheDocument()
    expect(screen.queryByRole("img", { name: "图片 1 预览" })).not.toBeInTheDocument()
  })
})
