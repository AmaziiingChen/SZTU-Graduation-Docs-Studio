import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  OutlineEditor,
  renumberOutlineItems,
  validateOutlineItems,
  type OutlineEditorItem,
} from "./outline-editor"

const items: OutlineEditorItem[] = [
  { id: "one", level: 1, number: "1", title: "绪论" },
  { id: "two", level: 1, number: "2", title: "研究方法" },
]

afterEach(cleanup)

describe("OutlineEditor", () => {
  it("uses semantic levels instead of leading whitespace", () => {
    const onChange = vi.fn()
    render(<OutlineEditor value={items} onChange={onChange} />)

    const secondTitle = screen.getByRole("button", {
      name: "第 2 条目录标题",
    })
    fireEvent.keyDown(secondTitle, { key: "Tab" })

    expect(onChange).toHaveBeenCalledWith([
      items[0],
      { ...items[1], level: 2 },
    ])
  })

  it("adds a same-level item with Enter", () => {
    const onChange = vi.fn()
    render(<OutlineEditor value={items} onChange={onChange} />)

    fireEvent.keyDown(screen.getByRole("button", { name: "第 2 条目录标题" }), {
      key: "Enter",
    })

    const next = onChange.mock.calls[0][0] as OutlineEditorItem[]
    expect(next).toHaveLength(3)
    expect(next[2]).toMatchObject({ level: 1, number: "", title: "" })
  })
})

describe("outline helpers", () => {
  it("renumbers four-level outline items deterministically", () => {
    expect(
      renumberOutlineItems([
        { id: "1", level: 1, number: "", title: "一" },
        { id: "2", level: 2, number: "", title: "二" },
        { id: "3", level: 2, number: "", title: "三" },
        { id: "4", level: 1, number: "", title: "四" },
      ]).map((item) => item.number),
    ).toEqual(["1", "1.1", "1.2", "2"])
  })

  it("rejects skipped levels and empty titles", () => {
    expect(
      validateOutlineItems([
        { id: "1", level: 1, number: "1", title: "绪论" },
        { id: "2", level: 3, number: "1.1.1", title: "" },
      ]),
    ).toHaveLength(2)
  })

  it("rejects levels outside the supported range", () => {
    expect(
      validateOutlineItems([
        { id: "1", level: 1, number: "1", title: "绪论" },
        {
          id: "2",
          level: 5 as OutlineEditorItem["level"],
          number: "1.1.1.1.1",
          title: "非法五级目录",
        },
      ]),
    ).toContain("第 2 条目录层级必须是 1 至 4。")
  })

  it("does not indent a subtree whose descendants would exceed four levels", () => {
    const onChange = vi.fn()
    const nested: OutlineEditorItem[] = [
      { id: "1", level: 1, number: "1", title: "A" },
      { id: "2", level: 2, number: "1.1", title: "B" },
      { id: "3", level: 3, number: "1.1.1", title: "C" },
      { id: "4", level: 4, number: "1.1.1.1", title: "D" },
      { id: "5", level: 2, number: "1.2", title: "E" },
      { id: "6", level: 3, number: "1.2.1", title: "F" },
      { id: "7", level: 4, number: "1.2.1.1", title: "G" },
    ]
    render(<OutlineEditor value={nested} onChange={onChange} />)

    expect(
      screen.getByRole("button", { name: "第 5 条目录：增加缩进" }),
    ).toBeDisabled()
    fireEvent.keyDown(
      screen.getByRole("button", { name: "第 5 条目录标题" }),
      { key: "Tab" },
    )
    expect(onChange).not.toHaveBeenCalled()
  })

  it("uses one shared inline editor and preserves a rich directory title", () => {
    const richItems: OutlineEditorItem[] = [
      items[0],
      {
        ...items[1],
        title: {
          type: "paragraph",
          runs: [
            { text: "H" },
            { text: "2", script: "sub" },
            { text: "O 方法" },
          ],
        },
      },
    ]
    render(<OutlineEditor value={richItems} onChange={vi.fn()} />)

    fireEvent.click(
      screen.getByRole("button", { name: "第 2 条目录标题" }),
    )
    expect(screen.getByRole("textbox", { name: "第 2 条目录标题" })).toHaveTextContent(
      "H2O 方法",
    )
    expect(screen.getAllByRole("toolbar")).toHaveLength(1)
  })
})
