import { useState } from "react"
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react"
import { afterEach, expect, it } from "vitest"
import type { Editor } from "@tiptap/react"
import { ThesisDocumentEditor } from "./thesis-document-editor"
import { emptyThesisDraft, type ThesisDraft } from "@/lib/thesis-draft"
import { structuredBodyToTiptap } from "@/lib/structured-content-editor"

afterEach(cleanup)
it("keeps cover editing to a shadcn calendar and saves the chosen submission date", async () => {
  let saved = { ...emptyThesisDraft(), submissionDate: "2026-05-01" }
  function Harness() {
    const [draft, setDraft] = useState(saved)
    return <ThesisDocumentEditor value={draft} onChange={next => { saved = next; setDraft(next) }} activeSection="thesis_cover" />
  }
  render(<Harness />)
  const trigger = screen.getByLabelText("封面提交日期")
  expect(trigger).toHaveAttribute("data-slot", "popover-trigger")
  expect(trigger).toHaveTextContent("2026年5月1日")
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
  fireEvent.click(trigger)
  const day = await waitFor(() => document.querySelector(`button[data-day="${new Date(2026, 4, 2).toLocaleDateString("zh-CN")}"]`))
  expect(day).not.toBeNull()
  fireEvent.click(day!)
  expect(saved.submissionDate).toBe("2026-05-02")
  expect(trigger).toHaveTextContent("2026年5月2日")
})

it("shows generated sections without explanatory notes and embeds abstract editing", () => {
  const value = emptyThesisDraft()
  const { rerender } = render(<ThesisDocumentEditor value={value} onChange={() => {}} activeSection="thesis_declaration" />)
  expect(screen.getByText("模板生成")).toBeInTheDocument()
  expect(screen.queryByText(/作者签名和声明日期/)).not.toBeInTheDocument()
  rerender(<ThesisDocumentEditor value={value} onChange={() => {}} activeSection="thesis_directory" />)
  expect(screen.getByText("自动生成")).toBeInTheDocument()
  expect(screen.queryByText(/目录根据/)).not.toBeInTheDocument()
  rerender(<ThesisDocumentEditor value={value} onChange={() => {}} activeSection="thesis_abstract_cn" />)
  expect(screen.queryByLabelText("封面提交日期")).not.toBeInTheDocument()
  expect(screen.getByRole("textbox", { name: "摘要" })).toBeInTheDocument()
  expect(screen.getByText("关键词")).toBeInTheDocument()
  expect(document.querySelector('[data-slot="immersive-writing-surface"]')).not.toBeInTheDocument()
  const toolbar = screen.getByRole("toolbar", { name: "摘要格式工具栏" })
  const writingArea = screen.getByRole("textbox", { name: "摘要" })
  expect(toolbar.compareDocumentPosition(writingArea) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.queryByRole("heading", { name: "摘要" })).not.toBeInTheDocument()
  expect(screen.queryByText(/论文内容自动保存/)).not.toBeInTheDocument()
  rerender(<ThesisDocumentEditor value={value} onChange={() => {}} activeSection="thesis_abstract_en" />)
  expect(screen.getByRole("textbox", { name: "Abstract" })).toBeInTheDocument()
  expect(screen.queryByRole("heading", { name: "Abstract" })).not.toBeInTheDocument()
  expect(screen.queryByRole("textbox", { name: "英文题名" })).not.toBeInTheDocument()
  expect(screen.getByText("Key words")).toBeInTheDocument()
  rerender(<ThesisDocumentEditor value={value} onChange={() => {}} activeSection="thesis_acknowledgements" />)
  expect(screen.getByRole("textbox", { name: "致谢" })).toBeInTheDocument()
  expect(screen.queryByRole("heading", { name: "致谢" })).not.toBeInTheDocument()
  rerender(<ThesisDocumentEditor value={value} onChange={() => {}} activeSection="thesis_appendix" />)
  expect(screen.getByRole("textbox", { name: "附录" })).toBeInTheDocument()
  expect(screen.queryByRole("heading", { name: "附录" })).not.toBeInTheDocument()
})
it("edits embedded tables and restores them when switching chapters", async () => {
  let saved: ThesisDraft = { ...emptyThesisDraft(), chapters: [
    { id: "a", title: "实验", level: 1, body: [] },
    { id: "b", title: "结果", level: 1, body: [] },
  ] }
  function Harness() {
    const [draft, setDraft] = useState(saved)
    return <ThesisDocumentEditor value={draft} onChange={next => { saved = next; setDraft(next) }} activeSection="thesis_chapters" />
  }
  const { container } = render(<Harness />)
  expect(screen.getByRole("button", { name: "插入图表" })).toBeEnabled()
  const editor = (container.querySelector(".tiptap") as HTMLElement & { editor: Editor }).editor
  const table = { type: "data_table" as const, style: "three_line" as const, columns: [{ header: "项目" }, { header: "结果" }], rows: [{ cells: ["合成样本", "10"] }] }
  act(() => { editor.commands.insertContent(structuredBodyToTiptap([table]).content!); editor.commands.setNodeSelection(0) })
  await waitFor(() => expect(screen.getByRole("button", { name: "编辑图表" })).toBeEnabled())
  fireEvent.click(screen.getByRole("button", { name: "编辑图表" }))
  fireEvent.change(screen.getByRole("textbox", { name: "表题（可选）" }), { target: { value: "实验结果" } })
  fireEvent.click(screen.getByRole("button", { name: "确认三线表" }))
  await waitFor(() => expect(saved.chapters[0].body[0]).toMatchObject({ caption: "实验结果" }))
  fireEvent.click(screen.getByRole("combobox", { name: "选择章节" }))
  const secondChapter = await screen.findByRole("option", { name: "2 结果" })
  fireEvent.pointerDown(secondChapter, { pointerType: "mouse" })
  fireEvent.click(secondChapter)
  await waitFor(() => expect(container.querySelector("figure[data-table-block]")).toBeNull())
  fireEvent.click(screen.getByRole("combobox", { name: "选择章节" }))
  const firstChapter = await screen.findByRole("option", { name: "1 实验" })
  fireEvent.pointerDown(firstChapter, { pointerType: "mouse" })
  fireEvent.click(firstChapter)
  await waitFor(() => expect(container.querySelector("figure[data-table-block]")).toHaveTextContent("实验结果"))
})

it("refreshes external figure labels without remounting the editor or changing content", async () => {
  const { StructuredContentEditor } = await import("./structured-content-editor")
  const image = { type: "image" as const, id: "fig-numbering", chapter: 1, path: "assets/fixture.png", alt: "合成图", caption: "合成图" }
  const props = { value: [image, "见{{fig:fig-external}}"], onChange: () => {}, enableFigures: true }
  const { container, rerender } = render(<StructuredContentEditor {...props} figureNumbering={{ knownLabels: { "fig-external": "图 2-1" } }} />)
  const editor = (container.querySelector(".tiptap") as HTMLElement & { editor: Editor }).editor
  act(() => { editor.commands.setTextSelection(editor.state.doc.content.size - 1); editor.commands.insertContent("可撤销内容") })
  rerender(<StructuredContentEditor {...props} figureNumbering={{ startCounts: { 1: 2 }, knownLabels: { "fig-external": "图 3-1" } }} />)
  await waitFor(() => expect(container.querySelector(".tiptap")).toHaveTextContent("图 3-1"))
  expect(container.querySelector(".tiptap")).toHaveTextContent("图 1-3")
  expect((container.querySelector(".tiptap") as HTMLElement & { editor: Editor }).editor).toBe(editor)
  expect(editor.can().undo()).toBe(true)
})

it("inserts, edits and cancels equation source without changing its stable target", async () => {
  let saved: ThesisDraft = { ...emptyThesisDraft(), chapters: [{ id: "a", title: "方法", level: 1, body: ["正文"] }] }
  function Harness() {
    const [value, update] = useState(saved)
    return <ThesisDocumentEditor value={value} onChange={v => { saved = v; update(v) }} activeSection="thesis_chapters" />
  }
  const { container } = render(<Harness />)
  fireEvent.click(screen.getByRole("button", { name: "插入公式" }))
  fireEvent.change(screen.getByRole("textbox", { name: "公式 LaTeX 源码" }), { target: { value: "E=mc^{2}" } })
  fireEvent.click(screen.getByRole("button", { name: "确认插入" }))
  await waitFor(() => expect(saved.chapters[0].body.some(b => typeof b !== "string" && b.type === "equation")).toBe(true))
  const equation = saved.chapters[0].body.find(b => typeof b !== "string" && b.type === "equation")!
  const editor = (container.querySelector(".tiptap") as HTMLElement & { editor: Editor }).editor
  let pos = 0
  editor.state.doc.descendants((n, p) => { if (n.type.name === "equationBlock") pos = p })
  act(() => { editor.commands.setNodeSelection(pos) })
  fireEvent.click(await screen.findByRole("button", { name: "编辑公式" }))
  fireEvent.change(screen.getByRole("textbox", { name: "公式 LaTeX 源码" }), { target: { value: "cancelled" } })
  fireEvent.click(screen.getByRole("button", { name: "取消" }))
  expect(saved.chapters[0].body).toContainEqual(equation)
  fireEvent.click(screen.getByRole("button", { name: "编辑公式" }))
  fireEvent.change(screen.getByRole("textbox", { name: "公式 LaTeX 源码" }), { target: { value: "F=ma" } })
  fireEvent.click(screen.getByRole("button", { name: "确认插入" }))
  await waitFor(() => expect(saved.chapters[0].body).toContainEqual({ ...(equation as object), latex: "F=ma" }))
})

it("preserves equation and citation targets across editor JSON and copied HTML", async () => {
  const { Editor: ActualEditor } = await import("@tiptap/react")
  const { createRestrictedEditorExtensions, tiptapToStructuredBody } = await import("@/lib/structured-content-editor")
  const source = [{ type: "equation" as const, id: "eq-roundtrip", latex: String.raw`\\frac{a}{b}` }, "参见{{eq:eq-roundtrip}}和{{cite:source2026}}。"]
  const editor = new ActualEditor({ extensions: createRestrictedEditorExtensions(), content: structuredBodyToTiptap(source, { knownLabels: { "eq:eq-roundtrip": "式（1-1）", "cite:source2026": "[1]" } }) })
  expect(tiptapToStructuredBody(editor.getJSON())).toEqual(source)
  const restored = new ActualEditor({ extensions: createRestrictedEditorExtensions(), content: editor.getHTML() })
  expect(tiptapToStructuredBody(restored.getJSON())).toEqual(source)
  editor.destroy(); restored.destroy()
})

it("shows the bibliography in citation order and marks unused sources", () => {
  const value = { ...emptyThesisDraft(), referencesBibtex: "@book{a,title={Alpha},year={2026}}\n@book{b,title={Beta},year={2026}}\n@book{c,title={Gamma},year={2026}}", chapters: [{ id: "a", level: 1, title: "正文", body: ["{{cite:b}}，{{cite:a}}"] }] }
  render(<ThesisDocumentEditor value={value} onChange={() => {}} activeSection="thesis_references" />)
  const headings = screen.getAllByRole("heading", { level: 3 }).map(h => h.textContent)
  expect(headings[0]).toContain("[1] Beta")
  expect(headings[1]).toContain("[2] Alpha")
  expect(headings[2]).toContain("[未引用] Gamma")
})
