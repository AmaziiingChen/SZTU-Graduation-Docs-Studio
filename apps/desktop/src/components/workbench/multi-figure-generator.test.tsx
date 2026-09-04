import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
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

  it("starts with the layout card and keeps guidance and draft actions in its header", async () => {
    render(<MultiFigureGenerator />)

    const main = screen.getByRole("main", { name: "多图排版" })
    expect(
      within(main).queryByRole("heading", { name: "多图排版" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/图片只用于本机预览/)).not.toBeInTheDocument()
    const clearDraft = within(main).getByRole("button", { name: "清空草稿" })
    const cardHeader = clearDraft.closest('[data-slot="card-header"]')
    expect(cardHeader).not.toBeNull()
    expect(clearDraft.closest('[data-slot="card-action"]')).not.toBeNull()
    const guidance = within(cardHeader as HTMLElement).getByRole("button", {
      name: "图片使用说明",
    })
    fireEvent.focus(guidance)
    expect(await screen.findByText(/一次最多选择 12 张/)).toBeInTheDocument()
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
    const source = screen.getByLabelText<HTMLInputElement>("生成的 LaTeX 源码")
    expect(source.value).toContain("\\begin{subfigure}")
    expect(source.parentElement).toHaveClass("pb-4")
    expect(screen.getByText(/\\usepackage\{subcaption\}/)).toBeInTheDocument()
  })

  it("uses the selected files' object URLs in the visible layout preview", () => {
    render(<MultiFigureGenerator />)
    const file = new File(["image"], "preview.png", { type: "image/png" })

    fireEvent.change(screen.getByLabelText("选择图片"), {
      target: { files: [file] },
    })

    expect(URL.createObjectURL).toHaveBeenCalledWith(file)
    expect(screen.getByRole("img", { name: "图片 1 预览" })).toHaveAttribute(
      "src",
      "blob:preview.png",
    )
  })

  it("supports changing image order", () => {
    render(<MultiFigureGenerator />)
    const files = [
      new File(["a"], "a.png", { type: "image/png" }),
      new File(["b"], "b.png", { type: "image/png" }),
    ]
    fireEvent.change(screen.getByLabelText("选择图片"), { target: { files } })

    expect(
      screen.getByRole("button", { name: "拖动图片 1 调整顺序" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "拖动图片 2 调整顺序" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "上移图片 1" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "下移图片 2" })).toBeDisabled()

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
