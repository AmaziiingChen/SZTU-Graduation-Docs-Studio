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
  isStructuredBodyValue,
  structuredBodyToTiptap,
  tiptapToStructuredBody,
} from "@/lib/structured-content-editor"
import type { StructuredBodyValue } from "@/types/structured-content"

afterEach(cleanup)

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
})

describe("StructuredContentEditor", () => {
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
    expect(screen.getByText("正文")).toBeInTheDocument()
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
    expect(screen.getByText("多段内容")).toBeInTheDocument()
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
