import { Editor } from "@tiptap/react"
import { AllSelection } from "@tiptap/pm/state"
import { afterEach, describe, expect, it, vi } from "vitest"
import { tidyLists } from "@/lib/list-cleanup"
import { createRestrictedEditorExtensions, structuredAuthoringToTiptap, structuredBodyToTiptap, tiptapToStructuredBody } from "@/lib/structured-content-editor"
import type { StructuredBodyValue } from "@/types/structured-content"

const editors: Editor[] = []
function create(body: StructuredBodyValue, mode: "body" | "paragraphs" = "body") {
  const editor = new Editor({ extensions: createRestrictedEditorExtensions(mode, {}, false, true), content: structuredBodyToTiptap(body) })
  editors.push(editor)
  return editor
}
afterEach(() => { vi.restoreAllMocks(); editors.splice(0).forEach(editor => editor.destroy()) })

describe("list cleanup", () => {
  it("converts consecutive dotted paragraphs, leaving Chinese enumeration and following prose unchanged", () => {
    const editor = create(["1、保持原样", "2、保持原样", "1. 第一项", "2.第二项", "这段说明独立保留。"])
    expect(tidyLists(editor)).toMatchObject({ groups: 1, items: 2 })
    expect(tiptapToStructuredBody(editor.getJSON())).toEqual([
      "1、保持原样", "2、保持原样", { type: "ordered_list", items: [{ content: "第一项" }, { content: "第二项" }] }, "这段说明独立保留。",
    ])
    expect(tidyLists(editor).groups).toBe(0)
  })

  it("preserves start numbers in storage and keeps numbering live after reload and item insertion/deletion", () => {
    const editor = create(["3. 方法甲", "4. 方法乙"])
    tidyLists(editor)
    const saved = tiptapToStructuredBody(editor.getJSON())
    expect(saved).toEqual([{ type: "ordered_list", items: [{ marker: "3.", content: "方法甲" }, { marker: "4.", content: "方法乙" }] }])
    const reopened = create(saved)
    expect(reopened.getHTML()).toContain('start="3"')
    reopened.commands.setTextSelection(6) // end of first item's body
    expect(reopened.commands.splitListItem("listItem")).toBe(true)
    reopened.commands.insertContent("插入项目")
    expect(tiptapToStructuredBody(reopened.getJSON())).toMatchObject([{ items: [
      { marker: "3.", content: "方法甲" }, { marker: "4.", content: "插入项目" }, { marker: "5.", content: "方法乙" },
    ] }])
    const firstSize = reopened.state.doc.firstChild!.firstChild!.nodeSize
    reopened.view.dispatch(reopened.state.tr.delete(1, 1 + firstSize))
    expect(tiptapToStructuredBody(reopened.getJSON())).toMatchObject([{ items: [
      { marker: "3.", content: "插入项目" }, { marker: "4.", content: "方法乙" },
    ] }])
  })

  it("serializes an editor-native non-one start even without existing contract markers", () => {
    const editor = create([])
    editor.commands.setContent({ type: "doc", content: [{ type: "orderedList", attrs: { start: 7 }, content: [
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "甲" }] }] },
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "乙" }] }] },
    ] }] })
    expect(tiptapToStructuredBody(editor.getJSON())).toEqual([{ type: "ordered_list", items: [{ marker: "7.", content: "甲" }, { marker: "8.", content: "乙" }] }])
  })

  it("retains nondecimal explicit list markers and existing nested lists", () => {
    const body: StructuredBodyValue = [{ type: "ordered_list", items: [
      { marker: "1、", content: "保留", children: { type: "unordered_list", items: [{ content: "1. 不整理嵌套正文" }] } },
      { marker: "2、", content: "原样" },
    ] }]
    const editor = create(body)
    expect(tidyLists(editor).groups).toBe(0)
    expect(tiptapToStructuredBody(editor.getJSON())).toEqual(body)
  })

  it("converts mixed clear bullet markers into a single unordered list", () => {
    const editor = create(["- 方法甲", "* 方法乙", "• 方法丙"])
    expect(tidyLists(editor)).toMatchObject({ groups: 1, items: 3 })
    expect(tiptapToStructuredBody(editor.getJSON())).toEqual([{ type: "unordered_list", items: [
      { content: "方法甲" }, { content: "方法乙" }, { content: "方法丙" },
    ] }])
  })

  it.each([
    ["1. 甲", "3. 乙"], ["1. 甲", "2. 乙", "4. 丙"], ["1. 甲", "1. 乙"],
    ["1. 单独项目"], ["1. 甲", "  2. 乙"], ["- 甲", "  - 乙"],
  ])("leaves incomplete or ambiguous group %j unchanged", (...body) => {
    const editor = create(body)
    const before = editor.getJSON()
    expect(tidyLists(editor).groups).toBe(0)
    expect(editor.getJSON()).toEqual(before)
  })

  it("does not consume decimals, chapter numbers, dates, negative numbers or source blocks", () => {
    const body = ["1.2 数据", "2.3 数据", "2026.10.4", "2027.10.4", "- 1", "- 2", "```text", "1. 代码甲", "2. 代码乙", "```", "$$", "1. 公式甲", "2. 公式乙", "$$", "参考文献", "1. 作者甲", "2. 作者乙"]
    const editor = create(body)
    const before = editor.getJSON()
    expect(tidyLists(editor).groups).toBe(0)
    expect(editor.getJSON()).toEqual(before)
  })

  it("preserves rich marks and inline equations while removing prefixes across runs", () => {
    const equation = { type: "inline_equation" as const, expression: { type: "text" as const, value: "x" }, alt: "x" }
    const editor = create([
      { runs: [{ text: "1", bold: true }, { text: ".  " }, { text: "加粗", bold: true }, { text: "[1]", script: "super" }, equation] },
      { runs: [{ text: "2. " }, { text: "斜体", italic: true }] },
    ])
    tidyLists(editor)
    expect(tiptapToStructuredBody(editor.getJSON())).toMatchObject([{ type: "ordered_list", items: [
      { content: { runs: [{ text: "加粗", bold: true }, { text: "[1]", script: "super" }, equation] } },
      { content: { runs: [{ text: "斜体", italic: true }] } },
    ] }])
  })

  it("handles only fully selected paragraphs and keeps a backwards selection on the body", () => {
    const editor = create(["1. 保留项目", "2. 选中甲", "3. 选中乙", "后续说明"])
    const firstEnd = editor.state.doc.child(0).nodeSize
    const lastEnd = firstEnd + editor.state.doc.child(1).nodeSize + editor.state.doc.child(2).nodeSize - 1
    editor.commands.setTextSelection({ from: lastEnd, to: firstEnd + 1 })
    expect(tidyLists(editor)).toMatchObject({ groups: 1, items: 2, selected: true })
    expect(tiptapToStructuredBody(editor.getJSON())).toEqual(["1. 保留项目", { type: "ordered_list", items: [
      { marker: "2.", content: "选中甲" }, { marker: "3.", content: "选中乙" },
    ] }, "后续说明"])
    expect(editor.state.selection.anchor).toBeGreaterThan(editor.state.selection.head)
    expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, "|")).toBe("选中甲|选中乙")
  })

  it("preserves caret placement and treats multiple groups as one isolated undo step", () => {
    const editor = create(["1. 第一项", "2. 第二项", "分隔说明", "- 方法甲", "- 方法乙"])
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.commands.insertContent("补充")
    const before = editor.getJSON()
    expect(tidyLists(editor).groups).toBe(2)
    const formatted = editor.getJSON()
    expect(editor.state.selection.$from.parent.textContent).toBe("方法乙补充")
    editor.commands.insertContent("后续")
    editor.commands.undo()
    expect(editor.getJSON()).toEqual(formatted)
    editor.commands.undo()
    expect(editor.getJSON()).toEqual(before)
    editor.commands.redo()
    expect(editor.getJSON()).toEqual(formatted)
  })

  it("supports Select All while leaving marked writing guidance alone", () => {
    const editor = create(["1. 方法甲", "2. 方法乙"])
    editor.commands.setContent(structuredAuthoringToTiptap(["1. 方法甲", "2. 方法乙"], {}, "1. 写作提示"))
    editor.view.dispatch(editor.state.tr.setSelection(new AllSelection(editor.state.doc)))
    expect(tidyLists(editor).items).toBe(2)
    expect(editor.state.doc.firstChild!.textContent).toBe("1. 写作提示")
    expect(editor.state.selection).toBeInstanceOf(AllSelection)
  })

  it("does not exceed the contract's list size or change read-only/composing editors", () => {
    const editor = create(Array.from({ length: 101 }, (_, i) => `${i + 1}. 内容`))
    expect(tidyLists(editor)).toMatchObject({ groups: 0, limited: 101 })
    const simple = create(["1. 方法甲", "2. 方法乙"])
    simple.setEditable(false)
    expect(tidyLists(simple).groups).toBe(0)
    simple.setEditable(true)
    vi.spyOn(simple.view, "composing", "get").mockReturnValue(true)
    expect(tidyLists(simple).groups).toBe(0)
    expect(tidyLists(create(["1. 方法甲", "2. 方法乙"], "paragraphs")).groups).toBe(0)
  })
})
