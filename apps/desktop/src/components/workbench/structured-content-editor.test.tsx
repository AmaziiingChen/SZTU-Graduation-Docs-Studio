import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { Editor } from "@tiptap/react"
import { closeHistory } from "@tiptap/pm/history"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  StructuredContentEditor,
} from "@/components/workbench/structured-content-editor"
import {
  createRestrictedEditorExtensions,
  AUTHORING_GUIDANCE_COMPOSITION,
  editorShortcutLabels,
  isStructuredBodyValue,
  structuredBodyToTiptap,
  structuredFigureCatalog,
  structuredFigureChapterCounts,
  tiptapToStructuredBody,
  structuredAuthoringToTiptap,
  structuredAuthoringFingerprint,
  tiptapToStructuredAuthoring,
} from "@/lib/structured-content-editor"
import type { ParagraphInput, StructuredBodyValue } from "@/types/structured-content"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("one-click editor cleanup controls", () => {
  it.each(["pointer", "focus", "window"])("dismisses the selection toolbar on outside %s interaction", async (interaction) => {
    render(<><StructuredContentEditor value={["选择文字"]} onChange={vi.fn()} selectionSnapshot={{ anchor: 1, head: 3 }} restoreFocus ariaLabel="关闭测试" /><button>其他区域</button></>)
    const textbox = screen.getByRole("textbox", { name: "关闭测试" }) as HTMLElement & { editor: Editor }
    await waitFor(() => expect(textbox).toHaveFocus())
    act(() => { textbox.editor.commands.setMeta("selection-formatting", "show") })
    const menu = document.querySelector('[aria-label="选中文字格式工具栏"]')!
    expect(menu).toHaveAttribute("data-state", "open")
    const outside = screen.getByRole("button", { name: "其他区域" })
    if (interaction === "pointer") fireEvent.pointerDown(document.body, { button: 0 })
    else if (interaction === "focus") act(() => { outside.focus() })
    else fireEvent.blur(window)
    await waitFor(() => expect(menu).not.toBeInTheDocument())
  })

  it.each(["inline", "body"] as const)("copies and pastes formatted text at the new caret and undoes in %s mode", (mode) => {
    const original: StructuredBodyValue = [{ type: "paragraph", runs: [{ text: "复制", bold: true, italic: false, script: "normal" }, { text: "后文", bold: false, italic: false, script: "normal" }] }]
    render(<StructuredContentEditor value={original} onChange={vi.fn()} mode={mode} ariaLabel="复制粘贴" />)
    const textbox = screen.getByRole("textbox", { name: "复制粘贴" }) as HTMLElement & { editor: Editor }
    const editor = textbox.editor
    const data: Record<string, string> = {}
    act(() => { editor.commands.setTextSelection({ from: 1, to: 3 }) })
    fireEvent.copy(textbox, { clipboardData: { clearData: () => {}, setData: (type: string, value: string) => { data[type] = value } } })
    expect(data["text/plain"]).toBe("复制")
    act(() => { editor.commands.setTextSelection(5) })
    fireEvent.paste(textbox, { clipboardData: { types: Object.keys(data), getData: (type: string) => data[type] ?? "" } })
    expect(editor.getText()).toBe("复制后文复制")
    expect(editor.getHTML()).toContain("后文<strong>复制</strong>")
    act(() => { editor.commands.undo() })
    expect(tiptapToStructuredBody(editor.getJSON())).toEqual(original)
  })

  it("pastes multiple paragraphs into an inline field without silently rejecting them", () => {
    render(<StructuredContentEditor value={["原文"]} onChange={vi.fn()} mode="inline" ariaLabel="粘贴测试" />)
    const textbox = screen.getByRole("textbox", { name: "粘贴测试" }) as HTMLElement & { editor: Editor }
    act(() => { textbox.editor.commands.setTextSelection(3) })
    fireEvent.paste(textbox, { clipboardData: { types: ["text/plain", "text/html"], getData: (type: string) => type === "text/html" ? "<p><strong>复制</strong></p><p>文字</p>" : "复制\n文字" } })
    expect(textbox.editor.getText()).toBe("原文复制 文字")
    expect(textbox.editor.getHTML()).toContain("<strong>复制</strong>")
  })

  it("merges cleanup into one icon button, one saved update and one undo", () => {
    const onChange = vi.fn()
    const value = ["3. 研究[1]，发展,OpenMV", "4. 结果[2]，H7,提供"]
    render(<StructuredContentEditor ariaLabel="统一整理正文" value={value} onChange={onChange} />)
    const editor = (screen.getByRole("textbox", { name: "统一整理正文" }) as HTMLElement & { editor: Editor }).editor
    const button = screen.getByRole("button", { name: "一键整理排版", exact: true })
    expect(button.textContent).toBe("")
    expect(button.querySelector("svg")).not.toBeNull()
    for (const name of ["引用上标", "整理中文标点", "整理列表"]) {
      expect(screen.queryByRole("button", { name, exact: true })).toBeNull()
    }
    fireEvent.mouseDown(button)
    fireEvent.click(button)
    expect(editor.getHTML()).toContain('start="3"')
    expect(editor.getHTML()).toContain("<sup>[1]</sup>，发展，OpenMV")
    expect(editor.getHTML()).toContain("<sup>[2]</sup>，H7，提供")
    expect(onChange).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole("button", { name: "撤销", exact: true }))
    expect(onChange).toHaveBeenLastCalledWith(value)
  })

  it("converts list paragraphs through the toolbar, saves numbering and undoes in one step", () => {
    const onChange = vi.fn()
    render(<StructuredContentEditor ariaLabel="列表整理正文" value={["3. 研究方法", "4. 实验验证", "1、保留写法"]} onChange={onChange} />)
    const editor = (screen.getByRole("textbox", { name: "列表整理正文" }) as HTMLElement & { editor: Editor }).editor
    fireEvent.click(screen.getByRole("button", { name: "一键整理排版", exact: true }))
    expect(onChange).toHaveBeenLastCalledWith([
      { type: "ordered_list", items: [{ marker: "3.", content: "研究方法" }, { marker: "4.", content: "实验验证" }] }, "1、保留写法",
    ])
    expect(editor.getHTML()).toContain('start="3"')
    fireEvent.click(screen.getByRole("button", { name: "撤销", exact: true }))
    expect(editor.getHTML()).not.toContain("<ol")
    expect(editor.getText()).toContain("3. 研究方法")
  })

  it("exposes combined cleanup in body and paragraph editors only", () => {
    const { rerender } = render(<StructuredContentEditor value={[]} onChange={vi.fn()} disabled />)
    expect(screen.getByRole("button", { name: "一键整理排版", exact: true })).toBeDisabled()
    rerender(<StructuredContentEditor value={[]} onChange={vi.fn()} mode="paragraphs" />)
    expect(screen.getByRole("button", { name: "一键整理排版", exact: true })).toBeEnabled()
    rerender(<StructuredContentEditor value={[]} onChange={vi.fn()} mode="inline" />)
    expect(screen.queryByRole("button", { name: "一键整理排版", exact: true })).toBeNull()
  })

  it("applies only selected citations, emits canonical changes and supports one undo", () => {
    const onChange = vi.fn()
    render(<StructuredContentEditor ariaLabel="整理正文" value={["研究[1][2]，中文,测试"]} onChange={onChange} />)
    const editor = (screen.getByRole("textbox", { name: "整理正文" }) as HTMLElement & { editor: Editor }).editor
    act(() => { editor.commands.setTextSelection({ from: 3, to: 6 }) })
    fireEvent.mouseDown(screen.getByRole("button", { name: "一键整理排版", exact: true }))
    fireEvent.click(screen.getByRole("button", { name: "一键整理排版", exact: true }))
    expect(editor.getHTML()).toContain("研究<sup>[1]</sup>[2]")
    expect(onChange).toHaveBeenLastCalledWith(tiptapToStructuredBody(editor.getJSON()))
    fireEvent.click(screen.getByRole("button", { name: "撤销", exact: true }))
    expect(editor.getHTML()).not.toContain("<sup>")
    act(() => { editor.commands.setTextSelection(1) })
    fireEvent.click(screen.getByRole("button", { name: "一键整理排版", exact: true }))
    expect(editor.getText()).toBe("研究[1][2]，中文，测试")
    expect(onChange).toHaveBeenLastCalledWith(tiptapToStructuredBody(editor.getJSON()))
  })

  it("disables cleanup with the editor and does not expose it in inline fields", () => {
    const { rerender } = render(<StructuredContentEditor value={["研究[1]"]} onChange={vi.fn()} disabled />)
    expect(screen.getByRole("button", { name: "一键整理排版", exact: true })).toBeDisabled()
    rerender(<StructuredContentEditor value={["研究[1]"]} onChange={vi.fn()} mode="inline" />)
    expect(screen.queryByRole("button", { name: "一键整理排版", exact: true })).toBeNull()
  })
})

describe("editable writing guidance in the shared body editor", () => {
  const guide = "（写作说明）"
  function createEditor(body: StructuredBodyValue = ["已有正文"], guidance: ParagraphInput | null = guide) {
    return new Editor({ extensions: createRestrictedEditorExtensions("body", {}, false, true), content: structuredAuthoringToTiptap(body, {}, guidance) })
  }

  it("keeps a marked guide separate from body without serializing its editor role", () => {
    const guidance = { runs: [{ text: guide, bold: true, italic: true }] }
    const editor = createEditor(["已有正文"], guidance)
    const value = tiptapToStructuredAuthoring(editor.getJSON())
    expect(value.body).toEqual(["已有正文"])
    expect(value.guidance).toMatchObject({ runs: [{ text: guide, bold: true, italic: true }] })
    expect(JSON.stringify(value)).not.toContain("authoringRole")
    expect(editor.getHTML()).not.toContain("authoringRole")
    expect(structuredAuthoringFingerprint(["已有正文"], guidance)).not.toBe(structuredAuthoringFingerprint(["已有正文"], null))
    editor.destroy()
  })

  it("edits guidance at the caret and makes an Enter split a normal body paragraph", () => {
    const editor = createEditor()
    editor.commands.setTextSelection({ from: 1, to: guide.length + 1 })
    editor.commands.insertContent("（修改后的说明）")
    expect(tiptapToStructuredAuthoring(editor.getJSON())).toEqual({ guidance: "（修改后的说明）", body: ["已有正文"] })
    editor.commands.setTextSelection("（修改后的说明）".length + 1)
    const enter = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true })
    editor.view.dom.dispatchEvent(enter)
    expect(enter.defaultPrevented).toBe(true)
    editor.commands.insertContent("新的一段正文")
    expect(tiptapToStructuredAuthoring(editor.getJSON())).toEqual({ guidance: "（修改后的说明）", body: ["新的一段正文", "已有正文"] })
    expect(editor.getJSON().content?.[1].attrs?.authoringRole).toBeNull()
    editor.destroy()
  })

  it("clears a deleted guide role, preserves body, and restores marks through undo and redo", () => {
    const editor = createEditor(["已有正文"], { runs: [{ text: guide, bold: true }] })
    editor.commands.setTextSelection({ from: 1, to: guide.length + 1 })
    editor.commands.deleteSelection()
    expect(tiptapToStructuredAuthoring(editor.getJSON())).toEqual({ guidance: null, body: ["已有正文"] })
    expect(editor.getJSON().content?.[0].attrs?.authoringRole).toBeNull()
    expect(editor.commands.undo()).toBe(true)
    expect(tiptapToStructuredAuthoring(editor.getJSON()).guidance).toMatchObject({ runs: [{ text: guide, bold: true }] })
    expect(editor.commands.redo()).toBe(true)
    editor.view.dispatch(closeHistory(editor.state.tr))
    editor.commands.insertContent("这里重新输入正文")
    expect(tiptapToStructuredAuthoring(editor.getJSON())).toEqual({ guidance: null, body: ["这里重新输入正文", "已有正文"] })
    editor.destroy()
  })

  it("preserves a guide converted to a list as body and restores its role on undo", () => {
    const editor = createEditor()
    editor.commands.setTextSelection(2)
    editor.commands.toggleBulletList()
    expect(tiptapToStructuredAuthoring(editor.getJSON())).toEqual({ guidance: null, body: [{ type: "unordered_list", items: [{ content: guide }] }, "已有正文"] })
    expect(editor.getJSON().content?.[0].content?.[0].content?.[0].attrs?.authoringRole).toBeNull()
    editor.commands.undo()
    expect(tiptapToStructuredAuthoring(editor.getJSON())).toEqual({ guidance: guide, body: ["已有正文"] })
    editor.destroy()
  })

  it("keeps non-text inline guide content in body instead of writing an invalid guide", () => {
    const equation = { type: "inline_equation" as const, expression: { type: "text" as const, value: "x" }, alt: "x" }
    const document = structuredAuthoringToTiptap(["已有正文"], {}, { runs: [{ text: "说明" }, equation] })
    const value = tiptapToStructuredAuthoring(document)
    expect(value.guidance).toBeNull()
    expect(value.body).toEqual([{ type: "paragraph", runs: [{ text: "说明", bold: false, italic: false, script: "normal" }, equation] }, "已有正文"])
  })

  it("moves a guide split by an image into body while keeping its text and the image", () => {
    const editor = createEditor()
    editor.commands.setTextSelection(3)
    editor.commands.insertContent({ type: "figureBlock", attrs: { path: "images/fixture.png", alt: "合成图片", chapter: 1 } })
    const result = tiptapToStructuredAuthoring(editor.getJSON())
    expect(result.guidance).toBeNull()
    expect(result.body).toContainEqual(expect.objectContaining({ type: "image", path: "images/fixture.png" }))
    expect(result.body.filter(item => typeof item === "string").join("")).toBe(`${guide}已有正文`)
    editor.commands.undo()
    expect(tiptapToStructuredAuthoring(editor.getJSON())).toEqual({ guidance: guide, body: ["已有正文"] })
    editor.destroy()
  })

  it("does not lose the guide role during an IME's temporarily empty replacement", () => {
    const editor = createEditor()
    editor.view.dispatch(editor.state.tr.setMeta(AUTHORING_GUIDANCE_COMPOSITION, true))
    editor.commands.setTextSelection({ from: 1, to: guide.length + 1 })
    editor.commands.deleteSelection()
    expect(editor.getJSON().content?.[0].attrs?.authoringRole).toBe("guidance")
    editor.commands.insertContent("（中文修改）")
    editor.view.dispatch(editor.state.tr.setMeta(AUTHORING_GUIDANCE_COMPOSITION, false))
    expect(tiptapToStructuredAuthoring(editor.getJSON())).toEqual({ guidance: "（中文修改）", body: ["已有正文"] })
    editor.destroy()
  })

  it("focuses the blank body after guidance and reports both values in one callback", async () => {
    const onChange = vi.fn()
    render(<StructuredContentEditor value={[]} guidance={guide} onChange={onChange} />)
    const textbox = screen.getByRole("textbox", { name: "正文内容" })
    expect(textbox.querySelectorAll("p")).toHaveLength(2)
    await waitFor(() => expect(textbox).toHaveFocus())
    expect(window.getSelection()?.anchorNode).toBe(textbox.querySelectorAll("p")[1])
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.paste(textbox, { clipboardData: { types: ["text/plain"], getData: (type: string) => type === "text/plain" ? "新的正文" : "" } })
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(["新的正文"], guide))
  })

  it("synchronizes external guide changes atomically with body after Chinese composition", async () => {
    const onChange = vi.fn()
    const { rerender } = render(<StructuredContentEditor value={["已有正文"]} guidance={guide} onChange={onChange} />)
    const textbox = screen.getByRole("textbox", { name: "正文内容" })
    fireEvent.compositionStart(textbox, { data: "研" })
    rerender(<StructuredContentEditor value={["外部正文"]} guidance="（外部说明）" onChange={onChange} />)
    expect(textbox).toHaveTextContent(guide)
    expect(textbox).toHaveTextContent("已有正文")
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.compositionEnd(textbox, { data: "研究" })
    await waitFor(() => expect(textbox).toHaveTextContent("（外部说明）"))
    expect(textbox).toHaveTextContent("外部正文")
    expect(onChange).not.toHaveBeenCalled()
  })

  it("reopens explicitly deleted guidance with a normal paragraph and keeps subsequent typing in body", async () => {
    const onChange = vi.fn()
    render(<StructuredContentEditor value={[]} guidance={null} onChange={onChange} />)
    const textbox = screen.getByRole("textbox", { name: "正文内容" })
    expect(textbox.querySelectorAll("p")).toHaveLength(1)
    fireEvent.focus(textbox)
    fireEvent.paste(textbox, { clipboardData: { types: ["text/plain"], getData: (type: string) => type === "text/plain" ? "删除后重写的正文" : "" } })
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(["删除后重写的正文"], null))
  })
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
  it("saves an image without manually entered alternative text", async () => {
    const onChange = vi.fn()
    vi.stubGlobal("sztuDesktop", {
      importImageAsset: vi.fn().mockResolvedValue({
        originalName: "iShot_2026-09-24.png",
        path: "assets/example.png",
        previewUrl: "sztu-asset://asset/example.png",
      }),
    })
    render(<StructuredContentEditor value={[]} onChange={onChange} enableFigures />)

    fireEvent.click(screen.getByRole("button", { name: "插入图片" }))
    expect(await screen.findByRole("dialog", { name: "图片排版" })).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "图片内容说明（可选）" })).toHaveValue("")
    fireEvent.change(screen.getByRole("textbox", { name: "题注" }), {
      target: { value: "实验装置示意图" },
    })
    fireEvent.click(screen.getByRole("button", { name: "保存图片" }))

    await waitFor(() => expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        type: "image",
        caption: "实验装置示意图",
        alt: "实验装置示意图",
      }),
    ]))
  })

  it("focuses a view-only blank paragraph after prefilled text", async () => {
    const onChange = vi.fn()
    render(
      <StructuredContentEditor
        value={["本课题研究方法、手段如下："]}
        onChange={onChange}
        startOnNewParagraph
      />,
    )

    const textbox = screen.getByRole("textbox", { name: "正文内容" })
    expect(textbox.querySelectorAll("p")).toHaveLength(2)
    await waitFor(() => expect(textbox).toHaveFocus())
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.paste(textbox, {
      clipboardData: {
        types: ["text/plain"],
        getData: (type: string) => type === "text/plain" ? "采用访谈法。" : "",
      },
    })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([
      "本课题研究方法、手段如下：",
      "采用访谈法。",
    ]))
  })

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

  it("loads legacy image blocks into the structured editor without losing the asset", () => {
    const imageBody = [
      { type: "image", path: "images/fixture.png", alt: "合成图片" },
    ]
    expect(isStructuredBodyValue(imageBody)).toBe(true)
    const editorDocument = structuredBodyToTiptap(
      imageBody as StructuredBodyValue,
    )
    expect(editorDocument.content?.[0]).toMatchObject({
      type: "figureBlock",
      attrs: { path: "images/fixture.png", alt: "合成图片", chapter: 1 },
    })
    expect(tiptapToStructuredBody(editorDocument)).toEqual([
      {
        type: "image",
        path: "images/fixture.png",
        alt: "合成图片",
        width_mm: 120,
        chapter: 1,
        caption: "",
      },
    ])
  })

  it("renders managed image URLs for single and grouped figures", () => {
    const fileName = `${"a".repeat(64)}.png`
    const path = `/private/document-assets/${fileName}`
    const value: StructuredBodyValue = [
      { type: "image", path, alt: "单图", caption: "单图" },
      {
        type: "figure_group",
        items: [
          { path, alt: "多图一", caption: "多图一" },
          { path, alt: "多图二", caption: "多图二" },
        ],
        caption: "组合图",
      },
    ]
    const editor = new Editor({
      extensions: createRestrictedEditorExtensions(),
      content: structuredBodyToTiptap(value),
    })
    const images = [...editor.view.dom.querySelectorAll("figure img")]
    expect(images).toHaveLength(3)
    expect(images.map((image) => image.getAttribute("src"))).toEqual(
      Array(3).fill(`sztu-asset://asset/${fileName}`),
    )
    editor.destroy()
  })

  it("recovers failed figure previews in the editor without changing document data", async () => {
    const fileName = `${"c".repeat(64)}.png`
    const readImageAssetPreview = vi.fn().mockResolvedValue("data:image/png;base64,aGVsbG8=")
    vi.stubGlobal("sztuDesktop", { readImageAssetPreview })
    const onChange = vi.fn()
    render(<StructuredContentEditor
      value={[{ type: "image", path: `/private/document-assets/${fileName}`, alt: "实验图", caption: "实验图" }]}
      onChange={onChange}
      enableFigures
    />)

    const image = screen.getByAltText("实验图") as HTMLImageElement
    fireEvent.error(image)
    await waitFor(() => expect(image.getAttribute("src")).toBe("data:image/png;base64,aGVsbG8="))
    expect(readImageAssetPreview).toHaveBeenCalledWith(fileName)
    expect(onChange).not.toHaveBeenCalled()
  })

  it("renumbers figures by chapter and keeps references bound to stable ids", () => {
    const value: StructuredBodyValue = [
      "结果见{{fig:fig-example_0001}}。",
      {
        type: "image",
        id: "fig-example_0001",
        path: "/tmp/example.png",
        alt: "实验结果",
        chapter: 2,
        caption: "实验结果",
      },
    ]
    const editor = new Editor({
      extensions: createRestrictedEditorExtensions(),
      content: structuredBodyToTiptap(value),
    })
    editor.commands.insertContent("")
    expect(editor.getJSON().content?.[0]?.content?.[1]).toMatchObject({
      type: "figureReference",
      attrs: { figureId: "fig-example_0001", label: "图 2-1" },
    })
    expect(editor.getJSON().content?.[1]).toMatchObject({
      type: "figureBlock",
      attrs: { figureId: "fig-example_0001", label: "图 2-1" },
    })
    expect(tiptapToStructuredBody(editor.getJSON())).toEqual([
      "结果见{{fig:fig-example_0001}}。",
      {
        type: "image",
        id: "fig-example_0001",
        path: "/tmp/example.png",
        alt: "实验结果",
        width_mm: 120,
        chapter: 2,
        caption: "实验结果",
      },
    ])
    editor.destroy()
  })

  it("keeps numbering and references continuous across both midterm body sections", () => {
    const research: StructuredBodyValue = [{
      type: "image",
      id: "fig-research_0001",
      path: "/tmp/research.png",
      alt: "研究流程",
      chapter: 2,
      caption: "研究流程",
    }]
    const progress: StructuredBodyValue = [
      "进展对照{{fig:fig-research_0001}}。",
      {
        type: "image",
        id: "fig-progress_0001",
        path: "/tmp/progress.png",
        alt: "进展结果",
        chapter: 2,
        caption: "进展结果",
      },
    ]
    const catalog = structuredFigureCatalog(research, progress)
    const numbering = {
      startCounts: structuredFigureChapterCounts(research),
      knownLabels: Object.fromEntries(catalog.map((figure) => [figure.id, figure.label])),
    }
    expect(catalog.map((figure) => figure.label)).toEqual(["图 2-1", "图 2-2"])
    const document = structuredBodyToTiptap(progress, numbering)
    expect(document.content?.[0]?.content?.[1]).toMatchObject({
      type: "figureReference",
      attrs: { figureId: "fig-research_0001", label: "图 2-1" },
    })
    expect(document.content?.[1]).toMatchObject({
      type: "figureBlock",
      attrs: { figureId: "fig-progress_0001", label: "图 2-2" },
    })
    const editor = new Editor({
      extensions: createRestrictedEditorExtensions("body", numbering),
      content: document,
    })
    editor.commands.insertContent("")
    expect(editor.getJSON().content?.[1]).toMatchObject({
      attrs: { label: "图 2-2" },
    })
    editor.destroy()
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
  it("keeps chart actions accessible and functional when their labels are shown only in tooltips", async () => {
    const onChange = vi.fn()
    render(<StructuredContentEditor ariaLabel="图表正文" value={[
      { type: "data_table", columns: [{ header: "项目" }, { header: "数值" }], rows: [{ cells: ["合成项目", "1"] }], caption: "合成表格" },
      "保留的正文",
    ]} onChange={onChange} enableDocumentTools />)
    const insert = screen.getByRole("button", { name: "插入图表", exact: true })
    expect(insert.textContent).toBe("")
    fireEvent.click(insert)
    expect(await screen.findByRole("menuitem", { name: "表格", exact: true })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    const editor = (screen.getByRole("textbox", { name: "图表正文" }) as HTMLElement & { editor: Editor }).editor
    act(() => { editor.commands.setNodeSelection(0) })
    const edit = await screen.findByRole("button", { name: "编辑图表", exact: true })
    const remove = screen.getByRole("button", { name: "删除图表", exact: true })
    expect(edit.textContent).toBe("")
    expect(remove.textContent).toBe("")
    fireEvent.click(edit)
    expect(await screen.findByRole("dialog", { name: "表格", exact: true })).toBeInTheDocument()
    expect(screen.getByLabelText("表题（可选）")).toHaveValue("合成表格")
    fireEvent.click(screen.getByRole("button", { name: "取消", exact: true }))
    act(() => { editor.commands.setNodeSelection(0) })
    fireEvent.click(screen.getByRole("button", { name: "删除图表", exact: true }))
    expect(onChange).toHaveBeenLastCalledWith(["保留的正文"])
  })

  it("keeps the toolbar fixed while the immersive writing surface owns scrolling", () => {
    const { container } = render(
      <div className="h-96">
        <StructuredContentEditor
          value={["沉浸式正文"]}
          onChange={vi.fn()}
          ariaLabel="沉浸式正文"
          footerMessage="请填写至少一段内容要求。"
          footerMessageId="content-error"
          fillHeight
        />
      </div>,
    )

    const toolbar = screen.getByRole("toolbar", {
      name: "沉浸式正文格式工具栏",
    })
    expect(toolbar).toHaveClass("shrink-0", "border-b")
    expect(toolbar.style.marginBottom).toBe("")
    expect(toolbar.parentElement).not.toHaveClass(
      "rounded-lg",
      "border",
      "focus-within:ring-3",
    )
    expect(screen.getByRole("textbox", { name: "沉浸式正文" })).toHaveClass(
      "flex-1",
      "cursor-text",
    )
    expect(container.querySelector('[data-slot="scroll-area"]')).toHaveClass(
      "min-h-0",
      "flex-1",
    )
    expect(screen.getByRole("status")).toHaveTextContent("字数 5")
    expect(screen.getByRole("status")).toHaveTextContent("段落 1")
    expect(screen.getByRole("status")).not.toHaveClass("border-t")

    const viewport = container.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    )
    expect(viewport).not.toBeNull()
    expect(viewport?.contains(toolbar)).toBe(true)
    expect(toolbar).toHaveClass("sticky", "top-0")
    expect(viewport?.contains(screen.getByRole("textbox", { name: "沉浸式正文" }))).toBe(true)
    expect(viewport?.querySelector<HTMLElement>(".relative.flex.flex-1.flex-col")?.style.paddingTop).toBe("")


    const message = screen.getByText("请填写至少一段内容要求。")
    expect(message).toHaveAttribute("id", "content-error")
    expect(message.parentElement).toHaveClass(
      "items-center",
      "justify-between",
    )
    expect(screen.getByRole("status").parentElement?.parentElement).toBe(
      message.parentElement,
    )
  })

  it("counts visible non-whitespace characters and non-empty paragraphs", () => {
    render(
      <div className="h-96">
        <StructuredContentEditor
          value={["第一段 有空格", "第二段。"]}
          onChange={vi.fn()}
          fillHeight
        />
      </div>,
    )

    const status = screen.getByRole("status")
    expect(status).toHaveTextContent("字数 10")
    expect(status).toHaveTextContent("段落 2")

    fireEvent.click(screen.getByRole("button", { name: /查看内容统计/ }))
    expect(screen.getByText("总字数")).toBeInTheDocument()
    expect(screen.getByText("中文字符")).toBeInTheDocument()
    expect(screen.getByText("英文单词")).toBeInTheDocument()
  })

  it("prioritizes the selected character count in the status summary", async () => {
    render(
      <div className="h-96">
        <StructuredContentEditor
          value={["选择文字"]}
          onChange={vi.fn()}
          selectionSnapshot={{ anchor: 1, head: 3 }}
          fillHeight
        />
      </div>,
    )

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("已选 2 字"),
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
      "显示格式标记",
      "撤销",
      "重做",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument()
    }
    expect(screen.queryByText("正文")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /标题|链接|图片|表格/ })).toBeNull()
  })

  it("toggles editor-only paragraph marks without changing document content", () => {
    const onChange = vi.fn()
    const { container } = render(
      <StructuredContentEditor
        value={["第一段", "第二段"]}
        onChange={onChange}
        ariaLabel="格式标记正文"
      />,
    )

    const editor = container.querySelector('[data-formatting-marks]')
    const toggle = screen.getByRole("button", { name: "显示格式标记" })
    expect(editor).toHaveAttribute("data-formatting-marks", "false")
    expect(toggle).toHaveAttribute("aria-pressed", "false")

    fireEvent.click(toggle)
    expect(editor).toHaveAttribute("data-formatting-marks", "true")
    expect(toggle).toHaveAttribute("aria-pressed", "true")
    expect(
      container.querySelectorAll('.formatting-mark[contenteditable="false"]'),
    ).toHaveLength(2)
    expect(onChange).not.toHaveBeenCalled()
  })

  it("shows a contextual formatting toolbar for a focused text selection", async () => {
    const onChange = vi.fn()
    render(
      <StructuredContentEditor
        value={["选择文字"]}
        onChange={onChange}
        selectionSnapshot={{ anchor: 1, head: 3 }}
        restoreFocus
        ariaLabel="浮动工具栏正文"
      />,
    )

    const floatingToolbar = await screen.findByRole("toolbar", {
      name: "选中文字格式工具栏",
    })
    expect(floatingToolbar).toBeInTheDocument()
    // JSDOM has no layout; the browser smoke test verifies floating position and visibility.
    expect(screen.getByLabelText("选区粗体")).toHaveAttribute(
      "aria-pressed",
      "false",
    )

    const textbox = screen.getByRole("textbox", { name: "浮动工具栏正文" })
    fireEvent.pointerDown(textbox, { button: 0 })
    await waitFor(() =>
      expect(screen.queryByLabelText("选区粗体")).not.toBeInTheDocument(),
    )
    fireEvent.pointerUp(window, { button: 0 })
    await waitFor(() =>
      expect(screen.getByLabelText("选区粗体")).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByLabelText("选区粗体"))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
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
