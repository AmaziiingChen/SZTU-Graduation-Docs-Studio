import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MultiFigureGenerator } from "@/components/workbench/multi-figure-generator"

afterEach(() => {
  cleanup()
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

    const source = screen.getByLabelText<HTMLInputElement>("生成的 LaTeX 源码").value
    expect(source.indexOf("b.png")).toBeLessThan(source.indexOf("a.png"))
  })
})
