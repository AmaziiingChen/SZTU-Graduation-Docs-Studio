import { Editor } from "@tiptap/react"
import { AllSelection, TextSelection } from "@tiptap/pm/state"
import { afterEach, describe, expect, it, vi } from "vitest"
import { tidyEditor, tidyFormatting } from "@/lib/editor-cleanup"
import {
  createRestrictedEditorExtensions,
  structuredBodyToTiptap,
  structuredAuthoringToTiptap,
  tiptapToStructuredBody,
} from "@/lib/structured-content-editor"
import type { StructuredBodyValue } from "@/types/structured-content"

const editors: Editor[] = []
function create(body: StructuredBodyValue) {
  const editor = new Editor({
    extensions: createRestrictedEditorExtensions("body", {}, false, true),
    content: structuredBodyToTiptap(body),
  })
  editors.push(editor)
  return editor
}
afterEach(() => { vi.restoreAllMocks(); editors.splice(0).forEach(editor => editor.destroy()) })

describe("local editor cleanup", () => {
  it("superscripts every supported form and is idempotent", () => {
    const editor = create(["已有研究[1][2][1,3][1-4][1-4,6]。"])
    expect(tidyEditor(editor, "citations").changed).toBe(5)
    expect(editor.getHTML()).toContain("<sup>[1][2][1,3][1-4][1-4,6]</sup>")
    expect(tidyEditor(editor, "citations").changed).toBe(0)
    expect(editor.getText()).toBe("已有研究[1][2][1,3][1-4][1-4,6]。")
  })

  it("matches across rich-text runs and survives canonical save/reload", () => {
    const editor = create([{ runs: [{ text: "研究[", bold: true }, { text: "1", italic: true }, { text: ",3]。" }] }])
    expect(tidyEditor(editor, "citations").changed).toBe(1)
    const saved = tiptapToStructuredBody(editor.getJSON())
    expect(saved).toMatchObject([{ runs: [
      { text: "研究", bold: true }, { text: "[", script: "super", bold: true },
      { text: "1", script: "super", italic: true }, { text: ",3]", script: "super" }, { text: "。" },
    ] }])
    const reopened = create(saved)
    expect(tidyEditor(reopened, "citations").changed).toBe(0)
    expect(tiptapToStructuredBody(reopened.getJSON())).toEqual(saved)
  })

  it("changes only complete citations in the selection and retains the selection", () => {
    const editor = create(["研究[1][2][3]。"])
    editor.commands.setTextSelection({ from: 4, to: 9 }) // tail of [1], all of [2]
    const before = editor.state.selection.toJSON()
    expect(tidyEditor(editor, "citations")).toMatchObject({ changed: 1, selected: true })
    expect(editor.getHTML()).toContain("研究[1]<sup>[2]</sup>[3]。")
    expect(editor.state.selection.toJSON()).toEqual(before)
  })

  it("groups the whole batch into one undo, separate from prior and later typing", () => {
    const editor = create(["研究[1][2]。"])
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.commands.insertContent("补充")
    const before = editor.getJSON()
    tidyEditor(editor, "citations")
    const cleaned = editor.getJSON()
    editor.commands.insertContent("后续")
    editor.commands.undo()
    expect(editor.getJSON()).toEqual(cleaned)
    editor.commands.undo()
    expect(editor.getJSON()).toEqual(before)
    editor.commands.redo()
    expect(editor.getJSON()).toEqual(cleaned)
  })

  it("skips formulas, source, URLs, bibliography items and ambiguous contexts", () => {
    const editor = create([
      "取值区间[1,3]，数组[1]，文献[2][3]，arr[3]，[[4]]。x ∈ [1,3]。",
      "源码 `[5]`，数学 $x[6]$，另有 \\(x[7]\\) 和 \\[x[8]\\]。",
      "https://example.test/[9] doi:10.1234/[10]",
      "[11] 张某. 示例条目。",
      { runs: [{ text: "下标[12]", script: "sub" }] },
      "正常研究[13]。",
      "参考文献", "[14] 示例", "其他条目[15]",
    ])
    expect(tidyEditor(editor, "citations").changed).toBe(1)
    expect(editor.getHTML()).toContain("正常研究<sup>[13]</sup>")
  })

  it("handles list paragraphs but leaves writing guidance alone", () => {
    const editor = create([{ type: "ordered_list", items: [{ content: "研究[1]", children: { type: "unordered_list", items: [{ content: "研究[2]" }] } }] }])
    editor.commands.setContent(structuredAuthoringToTiptap(tiptapToStructuredBody(editor.getJSON()), {}, "提示[3]"))
    expect(tidyEditor(editor, "citations").changed).toBe(2)
    expect(editor.getHTML()).toContain("提示[3]")
  })

  it("normalizes Chinese and mixed-script boundaries while preserving English and numbers", () => {
    const text = "结果表明,方法有效;结论如下:可以使用。数据 1,000 和 3.14，English, text; example: yes。采用 CNN,准确率提高。[1,3] 区间[0,1]"
    const editor = create([text])
    expect(tidyEditor(editor, "punctuation").changed).toBe(4)
    expect(editor.getText()).toBe(text.replace("表明,", "表明，").replace("有效;", "有效；").replace("如下:", "如下：").replace("CNN,", "CNN，"))
    expect(tidyEditor(editor, "punctuation").changed).toBe(0)
    editor.commands.undo()
    expect(editor.getText()).toBe(text)
  })

  it("cleans both screenshot boundaries and mixed-script semicolons/colons", () => {
    const text = "经过几年的发展,OpenMV Cam摄像头模块相继问世。OpenMV Cam H7,提供了更强处理能力。2020年,OpenMV开源了文件。采用Python;提供API。语言:Python。Python:适用于图像处理。数量:3。3,用于对照。"
    const editor = create([text])
    expect(tidyFormatting(editor).punctuation.changed).toBe(8)
    expect(editor.getText()).toBe("经过几年的发展，OpenMV Cam摄像头模块相继问世。OpenMV Cam H7，提供了更强处理能力。2020年，OpenMV开源了文件。采用Python；提供API。语言：Python。Python：适用于图像处理。数量：3。3，用于对照。")
    expect(tidyFormatting(editor).punctuation.changed).toBe(0)
    editor.commands.undo()
    expect(editor.getText()).toBe(text)
  })

  it("preserves protected mixed-script fragments and Latin/numeric punctuation inside Chinese prose", () => {
    const protectedText = "源码 `中文,OpenMV` 和 `H7,提供`，公式 $中文,Python$，网址 https://example.test/中文,OpenMV，邮件 test@example.com，[中文,OpenMV]。英文 Hello, world; language: Python。金额 1,000，时间 12:30，比例 1:2，型号 H7,M7，版本 1.2。"
    const editor = create([protectedText, "正常H7,提供说明。", "参考文献", "作者,OpenMV"])
    expect(tidyFormatting(editor).punctuation.changed).toBe(1)
    expect(editor.state.doc.firstChild!.textContent).toBe(protectedText)
    expect(editor.state.doc.lastChild!.textContent).toBe("作者,OpenMV")
  })

  it("preserves split rich-text marks and spaces at selected mixed-script boundaries across save/reload", () => {
    const editor = create([{ runs: [
      { text: "发展" }, { text: " ,", bold: true }, { text: " OpenMV", italic: true },
      { text: "。H7,提供" },
    ] }])
    editor.commands.setTextSelection({ from: 4, to: 5 })
    const selection = editor.state.selection.toJSON()
    expect(tidyFormatting(editor).punctuation.changed).toBe(1)
    expect(editor.state.selection.toJSON()).toEqual(selection)
    const saved = tiptapToStructuredBody(editor.getJSON())
    expect(saved).toMatchObject([{ runs: [
      { text: "发展" }, { text: " ，", bold: true }, { text: " OpenMV", italic: true },
      { text: "。H7,提供" },
    ] }])
    expect(tiptapToStructuredBody(create(saved).getJSON())).toEqual(saved)
  })

  it("preserves punctuation marks, spaces, scripts and selection scope", () => {
    const editor = create([{ runs: [{ text: "中文" }, { text: ",", bold: true, italic: true }, { text: " 测试;另一项" }] }])
    editor.commands.setTextSelection({ from: 3, to: 4 })
    expect(tidyEditor(editor, "punctuation").changed).toBe(1)
    expect(editor.getText()).toBe("中文， 测试;另一项")
    expect(tiptapToStructuredBody(editor.getJSON())).toMatchObject([{ runs: [
      { text: "中文" }, { text: "，", bold: true, italic: true }, { text: " 测试;另一项" },
    ] }])
  })

  it("leaves punctuation in raw math, links, code, citations and references untouched", () => {
    const text = "源码 `中文,测试`，公式 $中文,测试$，网址 https://example.test/中文,测试，[中文,测试]。普通中文,测试。"
    const editor = create([text, "[1] 作者,标题", "参考文献", "作者,标题"])
    expect(tidyEditor(editor, "punctuation").changed).toBe(1)
    expect(editor.getText()).toContain(text.replace("普通中文,测试", "普通中文，测试"))
  })

  it("does not touch a read-only editor or a composing editor", () => {
    const editor = create(["研究[1]，中文,测试"])
    editor.setEditable(false)
    expect(tidyEditor(editor, "citations").changed).toBe(0)
    expect(tidyEditor(editor, "punctuation").changed).toBe(0)
    editor.setEditable(true)
    vi.spyOn(editor.view, "composing", "get").mockReturnValue(true)
    expect(tidyEditor(editor, "citations").changed).toBe(0)
    expect(tidyEditor(editor, "punctuation").changed).toBe(0)
  })

  it("keeps inline equations and table cells intact without shifting later matches", () => {
    const editor = create([
      { runs: [{ text: "研究[" }, { type: "inline_equation", expression: { type: "text", value: "1" }, alt: "1" }, { text: "]，结果[2]。中文,测试" }] },
      { type: "data_table", columns: [{ header: "表头[3]" }, { header: "数值" }], rows: [{ cells: ["单元格[4]，中文,测试", "1"] }] },
    ])
    const tableBefore = editor.getJSON().content?.[1]
    expect(tidyEditor(editor, "citations").changed).toBe(1)
    expect(tidyEditor(editor, "punctuation").changed).toBe(1)
    expect(editor.getJSON().content?.[1]).toEqual(tableBefore)
    expect(editor.getHTML()).toContain("结果<sup>[2]</sup>")
  })

  it("skips multi-paragraph pasted code and display math", () => {
    const editor = create(["```", "源码[1]，中文,测试", "```", "$$", "公式[2]，中文,测试", "$$", "正文[3]，中文,测试"])
    expect(tidyEditor(editor, "citations").changed).toBe(1)
    expect(tidyEditor(editor, "punctuation").changed).toBe(1)
    expect(editor.getHTML()).toContain("正文<sup>[3]</sup>，中文，测试")
  })

  it("respects the export contract's run limit when a paragraph contains many citations", () => {
    const original = Array.from({ length: 60 }, (_, i) => `研究[${i + 1}]。`).join("")
    const editor = create([original])
    const result = tidyEditor(editor, "citations")
    expect(result.limited).toBeGreaterThan(0)
    expect(result.changed + result.limited).toBe(60)
    expect(editor.state.doc.firstChild!.childCount).toBeLessThanOrEqual(100)
    expect(editor.getText()).toBe(original)
    editor.commands.undo()
    expect(editor.getHTML()).not.toContain("<sup>")
  })
})


describe("combined formatting cleanup", () => {
  const input: StructuredBodyValue = [
    "3. 研究[1],中文,测试", "4. 结果[2];中文:说明",
    "- 条目,甲", "• 条目,乙", "1、保留编号", "2、保留编号",
  ]

  it("applies all rules in one change, preserves rich text and survives save/reload", () => {
    const editor = create([
      { runs: [{ text: "3. " }, { text: "研究[1]", bold: true }, { text: "，中文,测试" }] },
      "4. 结果[2]，中文:说明", ...input.slice(2),
    ])
    const update = vi.fn()
    editor.on("update", update)
    expect(tidyFormatting(editor)).toMatchObject({
      citations: { changed: 2 }, punctuation: { changed: 4 }, lists: { groups: 2, items: 4 },
    })
    expect(update).toHaveBeenCalledTimes(1)
    expect(editor.getHTML()).toContain('start="3"')
    expect(editor.getHTML()).toContain("<strong>研究<sup>[1]</sup></strong>")
    expect(editor.getText()).toContain("中文，测试")
    const saved = tiptapToStructuredBody(editor.getJSON())
    const reopened = create(saved)
    expect(tiptapToStructuredBody(reopened.getJSON())).toEqual(saved)
    expect(tidyFormatting(reopened)).toMatchObject({
      citations: { changed: 0 }, punctuation: { changed: 0 }, lists: { groups: 0 },
    })
    expect(saved.slice(-2)).toEqual(input.slice(-2))
  })

  it("undoes all three operations once, separate from preceding and following typing", () => {
    const editor = create(input)
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.commands.insertContent("之前")
    const before = editor.getJSON()
    tidyFormatting(editor)
    const cleaned = editor.getJSON()
    editor.commands.insertContent("之后")
    editor.commands.undo()
    expect(editor.getJSON()).toEqual(cleaned)
    editor.commands.undo()
    expect(editor.getJSON()).toEqual(before)
    editor.commands.redo()
    expect(editor.getJSON()).toEqual(cleaned)
  })

  it("keeps reversed selected paragraph scope while composing all operations", () => {
    const editor = create(["外部[8]，中文,保留", ...input, "外部[9]，中文,保留"])
    const from = editor.state.doc.firstChild!.nodeSize + 1
    const to = editor.state.doc.firstChild!.nodeSize + editor.state.doc.child(1).nodeSize + editor.state.doc.child(2).nodeSize - 1
    editor.commands.setTextSelection({ from: to, to: from })
    expect(tidyFormatting(editor)).toMatchObject({ selected: true, citations: { changed: 2 }, lists: { groups: 1 } })
    expect(editor.state.selection.anchor).toBeGreaterThan(editor.state.selection.head)
    expect(editor.state.doc.firstChild!.textContent).toBe("外部[8]，中文,保留")
    expect(editor.state.doc.lastChild!.textContent).toBe("外部[9]，中文,保留")
    expect(editor.getHTML()).not.toContain("<ul")
    const after = editor.getJSON()
    tidyFormatting(editor)
    expect(editor.getJSON()).toEqual(after)
  })

  it("supports select-all and does not create history or updates for an unchanged document", () => {
    const editor = create(input)
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)))
    expect(tidyFormatting(editor)).toMatchObject({ citations: { changed: 2 }, lists: { groups: 2 } })
    expect(editor.state.selection).toBeInstanceOf(AllSelection)
    const update = vi.fn()
    editor.on("update", update)
    tidyFormatting(editor)
    expect(update).not.toHaveBeenCalled()
    editor.commands.undo()
    expect(tiptapToStructuredBody(editor.getJSON())).toEqual(input)
  })

  it("skips list conversion in paragraphs mode while keeping citation and punctuation cleanup", () => {
    const editor = new Editor({ extensions: createRestrictedEditorExtensions("paragraphs"), content: structuredBodyToTiptap(input) })
    editors.push(editor)
    expect(tidyFormatting(editor)).toMatchObject({ citations: { changed: 2 }, punctuation: { changed: 4 }, lists: { groups: 0 } })
    expect(editor.getText()).toContain("3. 研究[1]")
  })

  it("does not apply any operation when readonly or during composition", () => {
    const editor = create(input)
    const before = editor.getJSON()
    editor.setEditable(false)
    tidyFormatting(editor)
    expect(editor.getJSON()).toEqual(before)
    editor.setEditable(true)
    vi.spyOn(editor.view, "composing", "get").mockReturnValue(true)
    tidyFormatting(editor)
    expect(editor.getJSON()).toEqual(before)
    expect(editor.state.selection).toBeInstanceOf(TextSelection)
  })
})
