import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { Editor } from "@tiptap/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  StructuredContentEditor,
} from "@/components/workbench/structured-content-editor"
import {
  createRestrictedEditorExtensions,
  editorShortcutLabels,
  isStructuredBodyValue,
  structuredBodyToTiptap,
  tiptapToStructuredBody,
} from "@/lib/structured-content-editor"
import type { StructuredBodyValue } from "@/types/structured-content"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const richValue: StructuredBodyValue = [
  "研究背景",
  {
    type: "paragraph",
    runs: [
      { text: "CO", bold: true, italic: false, script: "normal" },
      { text: "2", bold: false, italic: false, script: "sub" },
      { text: " 与 R", bold: false, italic: true, script: "normal" },
      { text: "2", bold: false, italic: false, script: "super" },
    ],
  },
  {
    type: "ordered_list",
    items: [
      {
        marker: "3.",
        content: "一级任务",
        children: {
          type: "unordered_list",
          items: [
            {
              content: "二级任务",
              children: {
                type: "ordered_list",
                items: [
                  {
                    content: "三级任务",
                    children: {
                      type: "unordered_list",
                      items: [{ content: "四级任务" }],
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    ],
  },
]

function deepestTextPosition(editor: Editor, text: string): number {
  let result = -1
  editor.state.doc.descendants((node, position) => {
    if (node.isText && node.text === text) result = position + 1
  })
  if (result < 0) throw new Error(`找不到文本：${text}`)
  return result
}

describe("structured content editor adapters", () => {
  it("represents an empty contract value with a valid empty editor paragraph", () => {
    const editorDocument = structuredBodyToTiptap([])
    expect(editorDocument).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    })
    expect(tiptapToStructuredBody(editorDocument)).toEqual([])
  })

  it("omits empty editor paragraphs from the saved body contract", () => {
    expect(
      tiptapToStructuredBody({
        type: "doc",
        content: [
          { type: "paragraph" },
          { type: "paragraph", content: [{ type: "text", text: "第一段" }] },
          { type: "paragraph", content: [{ type: "text", text: "   " }] },
          { type: "paragraph", content: [{ type: "text", text: "第二段" }] },
          { type: "paragraph" },
        ],
      }),
    ).toEqual(["第一段", "第二段"])
  })

  it("round-trips contract JSON without using HTML as authority", () => {
    const editorDocument = structuredBodyToTiptap(richValue)

    expect(editorDocument.type).toBe("doc")
    expect(editorDocument.content?.[2]).toMatchObject({
      type: "orderedList",
      attrs: { start: 3 },
    })
    expect(tiptapToStructuredBody(editorDocument)).toEqual(richValue)
    expect(JSON.stringify(editorDocument)).not.toContain("<p")
  })

  it("normalizes pasted Unicode scientific glyphs into semantic runs", () => {
    const normalized = tiptapToStructuredBody({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "g-C₃N₄ / CO₂ / R² / 10⁻³ mol·L⁻¹ / 550 ℃",
            },
          ],
        },
      ],
    })

    expect(normalized).toEqual([
      {
        type: "paragraph",
        runs: [
          { text: "g-C", bold: false, italic: false, script: "normal" },
          { text: "3", bold: false, italic: false, script: "sub" },
          { text: "N", bold: false, italic: false, script: "normal" },
          { text: "4", bold: false, italic: false, script: "sub" },
          { text: " / CO", bold: false, italic: false, script: "normal" },
          { text: "2", bold: false, italic: false, script: "sub" },
          { text: " / R", bold: false, italic: false, script: "normal" },
          { text: "2", bold: false, italic: false, script: "super" },
          { text: " / 10", bold: false, italic: false, script: "normal" },
          { text: "−3", bold: false, italic: false, script: "super" },
          { text: " mol·L", bold: false, italic: false, script: "normal" },
          { text: "−1", bold: false, italic: false, script: "super" },
          { text: " / 550 °C", bold: false, italic: false, script: "normal" },
        ],
      },
    ])

    const editorDocument = structuredBodyToTiptap([
      "CO₂ 还原与 550 ℃ 实验",
    ])
    expect(editorDocument.content?.[0]?.content).toEqual([
      { type: "text", text: "CO" },
      { type: "text", text: "2", marks: [{ type: "subscript" }] },
      { type: "text", text: " 还原与 550 °C 实验" },
    ])
  })

  it("rejects a fifth semantic list level", () => {
    const invalid = structuredClone(richValue)
    const fourthLevel = (
      invalid[2] as Extract<StructuredBodyValue[number], { type: "ordered_list" }>
    ).items[0].children?.items[0].children?.items[0].children?.items[0]

    if (!fourthLevel) throw new Error("测试夹具缺少四级列表")
    fourthLevel.children = {
      type: "ordered_list",
      items: [{ content: "第五级任务" }],
    }

    expect(() => structuredBodyToTiptap(invalid)).toThrow(
      "正文列表最多支持 4 级",
    )
  })

  it("rejects image blocks with a controlled text-only guard", () => {
    const imageBody = [
      { type: "image", path: "images/fixture.png", alt: "合成图片" },
    ]
    expect(isStructuredBodyValue(imageBody)).toBe(false)
    expect(() =>
      structuredBodyToTiptap(imageBody as unknown as StructuredBodyValue),
    ).toThrow("正文编辑器仅支持段落及四级以内的有序或无序列表")
  })

  it("maps Tab and Shift+Tab to semantic list nesting", () => {
    const initial: StructuredBodyValue = [
      {
        type: "ordered_list",
        items: [{ content: "第一项" }, { content: "第二项" }],
      },
    ]
    const editor = new Editor({
      extensions: createRestrictedEditorExtensions(),
      content: structuredBodyToTiptap(initial),
    })

    editor.commands.setTextSelection(deepestTextPosition(editor, "第二项"))
    expect(editor.commands.keyboardShortcut("Tab")).toBe(true)
    expect(tiptapToStructuredBody(editor.getJSON())).toEqual([
      {
        type: "ordered_list",
        items: [
          {
            content: "第一项",
            children: {
              type: "ordered_list",
              items: [{ content: "第二项" }],
            },
          },
        ],
      },
    ])

    expect(editor.commands.keyboardShortcut("Shift-Tab")).toBe(true)
    expect(tiptapToStructuredBody(editor.getJSON())).toEqual(initial)
    editor.destroy()
  })

  it("prevents browser focus traversal for Tab in multiline paragraphs", () => {
    for (const mode of ["body", "paragraphs"] as const) {
      const paragraphEditor = new Editor({
        extensions: createRestrictedEditorExtensions(mode),
        content: structuredBodyToTiptap(["普通正文段落"]),
      })
      const paragraphBefore = paragraphEditor.getJSON()
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

      paragraphEditor.view.dom.dispatchEvent(tabEvent)
      paragraphEditor.view.dom.dispatchEvent(shiftTabEvent)

      expect(tabEvent.defaultPrevented).toBe(true)
      expect(shiftTabEvent.defaultPrevented).toBe(true)
      expect(paragraphEditor.getJSON()).toEqual(paragraphBefore)
      paragraphEditor.destroy()
    }
  })

  it("blocks Tab from creating a fifth list level", () => {
    const fourLevels: StructuredBodyValue = [
      {
        type: "ordered_list",
        items: [
          {
            content: "一级",
            children: {
              type: "ordered_list",
              items: [
                {
                  content: "二级",
                  children: {
                    type: "ordered_list",
                    items: [
                      {
                        content: "三级",
                        children: {
                          type: "ordered_list",
                          items: [{ content: "四级甲" }, { content: "四级乙" }],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    ]
    const editor = new Editor({
      extensions: createRestrictedEditorExtensions(),
      content: structuredBodyToTiptap(fourLevels),
    })

    editor.commands.setTextSelection(deepestTextPosition(editor, "四级乙"))
    expect(editor.commands.keyboardShortcut("Tab")).toBe(true)
    expect(tiptapToStructuredBody(editor.getJSON())).toEqual(fourLevels)
    editor.destroy()
  })

  it("keeps inline formatting commands while omitting list nodes", () => {
    const editor = new Editor({
      extensions: createRestrictedEditorExtensions("inline"),
      content: structuredBodyToTiptap(["CO2 与 R2"]),
    })

    expect(editor.schema.marks).toMatchObject({
      bold: expect.anything(),
      italic: expect.anything(),
      subscript: expect.anything(),
      superscript: expect.anything(),
    })
    expect(editor.schema.nodes.orderedList).toBeUndefined()
    expect(editor.schema.nodes.bulletList).toBeUndefined()
    expect(editor.schema.nodes.listItem).toBeUndefined()

    editor.commands.setTextSelection({ from: 1, to: 3 })
    expect(editor.commands.toggleBold()).toBe(true)
    editor.commands.setTextSelection({ from: 3, to: 4 })
    expect(editor.commands.setSubscript()).toBe(true)
    editor.commands.setTextSelection({ from: 5, to: 8 })
    expect(editor.commands.toggleItalic()).toBe(true)
    editor.commands.setTextSelection({ from: 8, to: 9 })
    expect(editor.commands.setSuperscript()).toBe(true)

    expect(tiptapToStructuredBody(editor.getJSON())).toEqual([
      {
        type: "paragraph",
        runs: [
          { text: "CO", bold: true, italic: false, script: "normal" },
          { text: "2", bold: false, italic: false, script: "sub" },
          { text: " ", bold: false, italic: false, script: "normal" },
          { text: "与 R", bold: false, italic: true, script: "normal" },
          { text: "2", bold: false, italic: false, script: "super" },
        ],
      },
    ])
    editor.destroy()
  })

  it("consumes Enter and Shift+Enter in inline mode without adding a paragraph", () => {
    const editor = new Editor({
      extensions: createRestrictedEditorExtensions("inline"),
      content: structuredBodyToTiptap(["单行题目"]),
    })
    editor.commands.setTextSelection(5)
    const before = editor.getJSON()

    expect(editor.commands.keyboardShortcut("Enter")).toBe(true)
    expect(editor.getJSON()).toEqual(before)
    expect(editor.commands.keyboardShortcut("Shift-Enter")).toBe(true)
    expect(editor.getJSON()).toEqual(before)
    expect(editor.state.doc.childCount).toBe(1)
    editor.destroy()
  })

  it("keeps multiple paragraphs in paragraphs mode without exposing list nodes", () => {
    const editor = new Editor({
      extensions: createRestrictedEditorExtensions("paragraphs"),
      content: structuredBodyToTiptap(["第一段", "第二段"]),
    })

    expect(tiptapToStructuredBody(editor.getJSON())).toEqual([
      "第一段",
      "第二段",
    ])
    expect(editor.state.doc.childCount).toBe(2)
    expect(editor.schema.nodes.orderedList).toBeUndefined()
    expect(editor.schema.nodes.bulletList).toBeUndefined()
    expect(editor.schema.nodes.listItem).toBeUndefined()
    editor.destroy()
  })

  it("keeps the platform Command/Ctrl+B shortcut bound to bold", () => {
    const editor = new Editor({
      extensions: createRestrictedEditorExtensions("inline"),
      content: structuredBodyToTiptap(["需要加粗"]),
    })
    editor.commands.setTextSelection({ from: 1, to: 5 })

    expect(editor.commands.keyboardShortcut("Mod-b")).toBe(true)
    expect(tiptapToStructuredBody(editor.getJSON())).toEqual([
      {
        type: "paragraph",
        runs: [
          { text: "需要加粗", bold: true, italic: false, script: "normal" },
        ],
      },
    ])
    editor.destroy()
  })

  it("uses the Word-compatible platform shortcuts for subscript and superscript", () => {
    const editor = new Editor({
      extensions: createRestrictedEditorExtensions("inline"),
      content: structuredBodyToTiptap(["H2O"]),
    })
    editor.commands.setTextSelection({ from: 2, to: 3 })

    expect(editor.commands.keyboardShortcut("Mod-Shift--")).toBe(true)
    expect(tiptapToStructuredBody(editor.getJSON())).toEqual([
      {
        type: "paragraph",
        runs: [
          { text: "H", bold: false, italic: false, script: "normal" },
          { text: "2", bold: false, italic: false, script: "sub" },
          { text: "O", bold: false, italic: false, script: "normal" },
        ],
      },
    ])

    expect(editor.commands.keyboardShortcut("Mod-Shift-+")).toBe(true)
    expect(tiptapToStructuredBody(editor.getJSON())).toEqual([
      {
        type: "paragraph",
        runs: [
          { text: "H", bold: false, italic: false, script: "normal" },
          { text: "2", bold: false, italic: false, script: "super" },
          { text: "O", bold: false, italic: false, script: "normal" },
        ],
      },
    ])
    editor.destroy()
  })

  it("keeps Word-compatible undo and redo shortcuts active", () => {
    const editor = new Editor({
      extensions: createRestrictedEditorExtensions("inline"),
      content: structuredBodyToTiptap(["原文"]),
    })
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.commands.insertContent("新增")
    expect(editor.getText()).toBe("原文新增")

    const modifier = /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
      ? { metaKey: true }
      : { ctrlKey: true }
    const undoEvent = new KeyboardEvent("keydown", {
      key: "z",
      ...modifier,
      bubbles: true,
      cancelable: true,
    })
    editor.view.dom.dispatchEvent(undoEvent)
    expect(undoEvent.defaultPrevented).toBe(true)
    expect(editor.getText()).toBe("原文")

    const redoEvent = new KeyboardEvent("keydown", {
      key: "y",
      ...modifier,
      bubbles: true,
      cancelable: true,
    })
    editor.view.dom.dispatchEvent(redoEvent)
    expect(redoEvent.defaultPrevented).toBe(true)
    expect(editor.getText()).toBe("原文新增")
    editor.destroy()
  })
})

describe("StructuredContentEditor", () => {
  it("keeps the toolbar fixed while the immersive writing surface owns scrolling", () => {
    const { container } = render(
      <div className="h-96">
        <StructuredContentEditor
          value={["沉浸式正文"]}
          onChange={vi.fn()}
          ariaLabel="沉浸式正文"
          fillHeight
        />
      </div>,
    )

    const toolbar = screen.getByRole("toolbar", {
      name: "沉浸式正文格式工具栏",
    })
    expect(toolbar).toHaveClass("shrink-0", "border-b")
    expect(toolbar.parentElement).not.toHaveClass(
      "rounded-lg",
      "border",
      "focus-within:ring-3",
    )
    expect(screen.getByRole("textbox", { name: "沉浸式正文" })).toHaveClass(
      "min-h-full",
    )
    expect(container.querySelector('[data-slot="scroll-area"]')).toHaveClass(
      "min-h-0",
      "flex-1",
    )
  })

  it("renders only the allowlisted controls and exposes the current structure", () => {
    render(
      <StructuredContentEditor
        value={["初始正文"]}
        onChange={vi.fn()}
        ariaLabel="开题报告正文"
      />,
    )

    expect(screen.getByRole("textbox", { name: "开题报告正文" })).toHaveTextContent(
      "初始正文",
    )
    for (const label of [
      "粗体",
      "斜体",
      "下标",
      "上标",
      "有序列表",
      "无序列表",
      "减少缩进",
      "增加缩进",
      "撤销",
      "重做",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument()
    }
    expect(screen.queryByText("正文")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /标题|链接|图片|表格/ })).toBeNull()
  })

  it("shows inline formatting controls without list or indent controls", () => {
    render(
      <StructuredContentEditor
        value={["统一题目"]}
        onChange={vi.fn()}
        ariaLabel="论文题目"
        mode="inline"
      />,
    )

    const textbox = screen.getByRole("textbox", { name: "论文题目" })
    expect(textbox).toHaveAttribute("aria-multiline", "false")
    expect(textbox.className).not.toContain("[&>p+p]:mt-2")
    for (const label of ["粗体", "斜体", "下标", "上标", "撤销", "重做"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument()
    }
    for (const label of ["有序列表", "无序列表", "减少缩进", "增加缩进"]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull()
    }
    expect(screen.queryByText("单行内容")).not.toBeInTheDocument()
  })

  it("builds platform-specific editor shortcut labels for the tooltips", () => {
    expect(editorShortcutLabels("MacIntel")).toMatchObject({
      bold: ["⌘", "B"],
      italic: ["⌘", "I"],
      subscript: ["⌘", "⇧", "−"],
      superscript: ["⌘", "⇧", "+"],
      outdent: ["⇧", "Tab"],
      indent: ["Tab"],
      undo: ["⌘", "Z"],
      redo: ["⌘", "Y"],
    })
    expect(editorShortcutLabels("Win32")).toMatchObject({
      bold: ["Ctrl", "B"],
      italic: ["Ctrl", "I"],
      subscript: ["Ctrl", "Shift", "−"],
      superscript: ["Ctrl", "Shift", "+"],
      outdent: ["Shift", "Tab"],
      indent: ["Tab"],
      undo: ["Ctrl", "Z"],
      redo: ["Ctrl", "Y"],
    })
  })

  it("shows paragraphs mode as multiline while withholding list controls", () => {
    render(
      <StructuredContentEditor
        value={["第一段", "第二段"]}
        onChange={vi.fn()}
        ariaLabel="选题意义"
        mode="paragraphs"
      />,
    )

    const textbox = screen.getByRole("textbox", { name: "选题意义" })
    expect(textbox).toHaveAttribute("aria-multiline", "true")
    expect(textbox.className).toContain("leading-6")
    expect(textbox.className).toContain("[&>p+p]:mt-2")
    expect(textbox).toHaveTextContent("第一段")
    expect(textbox).toHaveTextContent("第二段")
    expect(screen.queryByText("多段内容")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "有序列表" })).toBeNull()
    expect(screen.queryByRole("button", { name: "无序列表" })).toBeNull()
    expect(screen.queryByRole("button", { name: "增加缩进" })).toBeNull()
    expect(screen.queryByRole("button", { name: "减少缩进" })).toBeNull()
  })

  it("applies an external structured value when it is safe to do so", async () => {
    const { rerender } = render(
      <StructuredContentEditor value={["旧内容"]} onChange={vi.fn()} />,
    )
    const textbox = screen.getByRole("textbox", { name: "正文内容" })

    rerender(<StructuredContentEditor value={["新内容"]} onChange={vi.fn()} />)

    await waitFor(() => expect(textbox).toHaveTextContent("新内容"))
    expect(textbox).not.toHaveTextContent("旧内容")
  })

  it("restores a saved selection without stealing focus from other controls", async () => {
    const onSelectionChange = vi.fn()
    const { rerender } = render(
      <>
        <button type="button">其他操作</button>
        <StructuredContentEditor
          value={["编辑位置恢复"]}
          onChange={vi.fn()}
          onSelectionChange={onSelectionChange}
        />
      </>,
    )
    const otherAction = screen.getByRole("button", { name: "其他操作" })
    otherAction.focus()

    rerender(
      <>
        <button type="button">其他操作</button>
        <StructuredContentEditor
          value={["编辑位置恢复"]}
          onChange={vi.fn()}
          selectionSnapshot={{ anchor: 3, head: 5 }}
          onSelectionChange={onSelectionChange}
        />
      </>,
    )

    await waitFor(() =>
      expect(onSelectionChange).toHaveBeenCalledWith({ anchor: 3, head: 5 }),
    )
    expect(otherAction).toHaveFocus()
  })

  it("does not reset the editor while a Chinese IME composition is active", async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <StructuredContentEditor value={["正在输入"]} onChange={onChange} />,
    )
    const textbox = screen.getByRole("textbox", { name: "正文内容" })

    fireEvent.compositionStart(textbox, { data: "研" })
    rerender(
      <StructuredContentEditor value={["外部更新"]} onChange={onChange} />,
    )

    expect(onChange).not.toHaveBeenCalled()
    expect(textbox).toHaveTextContent("正在输入")
    expect(textbox).not.toHaveTextContent("外部更新")

    fireEvent.compositionEnd(textbox, { data: "研究" })
    await waitFor(() => expect(textbox).toHaveTextContent("外部更新"))
    expect(onChange).not.toHaveBeenCalled()
  })
})
