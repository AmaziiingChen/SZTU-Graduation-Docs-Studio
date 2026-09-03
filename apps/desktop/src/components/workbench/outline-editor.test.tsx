import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  OutlineEditor,
  renumberOutlineItems,
  validateOutlineItems,
  type OutlineEditorItem,
} from "./outline-editor"

const items: OutlineEditorItem[] = [
  { id: "one", level: 1, number: "1.", title: "绪论" },
  { id: "two", level: 1, number: "2.", title: "研究方法" },
]

afterEach(cleanup)

describe("OutlineEditor", () => {
  it("uses semantic levels instead of leading whitespace", () => {
    const onChange = vi.fn()
    render(
      <OutlineEditor
        value={items}
        numberingStyle="decimal_hierarchy"
        onChange={onChange}
        onNumberingStyleChange={vi.fn()}
      />,
    )

    const secondTitle = screen.getByRole("button", {
      name: "第 2 条目录标题",
    })
    fireEvent.keyDown(secondTitle, { key: "Tab" })

    expect(onChange).toHaveBeenCalledWith([
      items[0],
      { ...items[1], level: 2, number: "1.1" },
    ])
  })

  it("adds a same-level item with Enter", () => {
    const onChange = vi.fn()
    render(
      <OutlineEditor
        value={items}
        numberingStyle="decimal_hierarchy"
        onChange={onChange}
        onNumberingStyleChange={vi.fn()}
      />,
    )

    fireEvent.keyDown(screen.getByRole("button", { name: "第 2 条目录标题" }), {
      key: "Enter",
    })

    const next = onChange.mock.calls[0][0] as OutlineEditorItem[]
    expect(next).toHaveLength(3)
    expect(next[2]).toMatchObject({ level: 1, number: "3.", title: "" })
  })

  it("switches the whole outline to an official numbering preset", async () => {
    const onNumberingStyleChange = vi.fn()
    render(
      <OutlineEditor
        value={items}
        numberingStyle={null}
        onChange={vi.fn()}
        onNumberingStyleChange={onNumberingStyleChange}
      />,
    )

    fireEvent.click(screen.getByRole("combobox", { name: "目录类型" }))
    fireEvent.click(
      await screen.findByRole("option", {
        name: /第一种目录类型/,
      }),
    )

    expect(onNumberingStyleChange).toHaveBeenCalledWith("chinese_hierarchy")
  })

  it("shows the thesis front and back matter as fixed unnumbered entries", () => {
    render(
      <OutlineEditor
        value={items}
        numberingStyle="decimal_hierarchy"
        onChange={vi.fn()}
        onNumberingStyleChange={vi.fn()}
      />,
    )

    for (const title of ["摘要", "Abstract", "参考文献", "致谢"]) {
      expect(screen.getByLabelText(`固定目录项：${title}`)).toBeInTheDocument()
    }
    expect(screen.getByRole("status")).toHaveTextContent("目录 6 项 · 1 级")

    fireEvent.click(screen.getByRole("button", { name: /查看内容统计/ }))
    expect(screen.getByText("可编辑条目")).toBeInTheDocument()
    expect(screen.getByText("固定条目")).toBeInTheDocument()
  })
})

describe("outline helpers", () => {
  it("renumbers outline items with the selected style", () => {
    expect(
      renumberOutlineItems([
        { id: "1", level: 1, number: "", title: "一" },
        { id: "2", level: 2, number: "", title: "二" },
        { id: "3", level: 2, number: "", title: "三" },
        { id: "4", level: 1, number: "", title: "四" },
      ]).map((item) => item.number),
    ).toEqual(["1.", "1.1", "1.2", "2."])
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
          level: 7 as OutlineEditorItem["level"],
          number: "1.1.1.1.1.1.1",
          title: "非法七级目录",
        },
      ]),
    ).toContain("第 2 条目录层级必须是 1 至 6。")
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
    render(
      <OutlineEditor
        value={nested}
        numberingStyle="chinese_hierarchy"
        onChange={onChange}
        onNumberingStyleChange={vi.fn()}
      />,
    )

    expect(
      screen.getByRole("button", { name: "第 5 条目录：增加缩进" }),
    ).toBeDisabled()
    const titleButton = screen.getByRole("button", {
      name: "第 5 条目录标题",
    })
    const tabEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    })
    const shiftTabEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })

    titleButton.dispatchEvent(tabEvent)
    screen.getByRole("button", { name: "第 1 条目录标题" }).dispatchEvent(
      shiftTabEvent,
    )

    expect(tabEvent.defaultPrevented).toBe(true)
    expect(shiftTabEvent.defaultPrevented).toBe(true)
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
    render(
      <OutlineEditor
        value={richItems}
        numberingStyle="decimal_hierarchy"
        onChange={vi.fn()}
        onNumberingStyleChange={vi.fn()}
      />,
    )

    fireEvent.click(
      screen.getByRole("button", { name: "第 2 条目录标题" }),
    )
    expect(screen.getByRole("textbox", { name: "第 2 条目录标题" })).toHaveTextContent(
      "H2O 方法",
    )
    expect(screen.getAllByRole("toolbar")).toHaveLength(1)
  })
})
