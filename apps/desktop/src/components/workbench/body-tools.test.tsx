import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { Editor } from "@tiptap/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BodyToolDialog } from "@/components/workbench/body-tool-dialog"
import { StructuredContentEditor } from "@/components/workbench/structured-content-editor"
import { createRestrictedEditorExtensions, isStructuredBodyValue, structuredBodyToTiptap, structuredFigureCatalog, structuredProcessEquationChapterCounts, structuredProcessEquationLabels, tiptapToStructuredBody } from "@/lib/structured-content-editor"
import type { StructuredDataTableBlock, StructuredFigureGroupBlock } from "@/types/structured-content"
const table: StructuredDataTableBlock = { type: "data_table", style: "three_line", columns: [{ header: "项目" }, { header: "结果", alignment: "right", width_weight: 2 }], rows: [{ cells: ["样本", { runs: [{ text: "10", bold: true }] }] }], caption: "测试表" }
const group: StructuredFigureGroupBlock = { type: "figure_group", id: "fig-tools_0001", chapter: 2, columns: 2, caption: "组合图", items: ["a", "b", "c", "d"].map((value, index) => ({ path: `/assets/${value.repeat(64)}.png`, alt: `图片 ${index}`, caption: `条件 ${index}` })) }
afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe("embedded body tools", () => {
  it("preserves process-document inline and display math through editor state and HTML", () => {
    const inline = { type: "inline_equation" as const, expression: { type: "fraction" as const, numerator: { type: "text" as const, value: "a" }, denominator: { type: "text" as const, value: "b" } }, alt: "a 除以 b" }
    const display = { type: "equation" as const, expression: { type: "square_root" as const, body: { type: "text" as const, value: "x" } }, alt: "x 的平方根", chapter: 1 }
    const value = [{ type: "paragraph" as const, runs: [{ text: "计算 ", bold: false, italic: false, script: "normal" as const }, inline, { text: " 得到结果。", bold: false, italic: false, script: "normal" as const }] }, display]
    const editor = new Editor({ extensions: createRestrictedEditorExtensions("body"), content: structuredBodyToTiptap(value) })
    expect(tiptapToStructuredBody(editor.getJSON())).toEqual(value)
    const restored = new Editor({ extensions: createRestrictedEditorExtensions("body"), content: editor.getHTML() })
    expect(tiptapToStructuredBody(restored.getJSON())).toEqual(value)
    editor.destroy(); restored.destroy()
  })
  it("continues display-formula numbering across document sections", () => {
    const first = { type: "equation" as const, id: "eq-first0001", chapter: 1, expression: { type: "text" as const, value: "a" }, alt: "a" }
    const second = { type: "equation" as const, id: "eq-second001", chapter: 1, expression: { type: "text" as const, value: "b" }, alt: "b" }
    const counts = structuredProcessEquationChapterCounts([first])
    const labels = structuredProcessEquationLabels([first], [second])
    expect(labels).toEqual({ "eq:eq-first0001": "(1-1)", "eq:eq-second001": "(1-2)" })
    const editor = new Editor({
      extensions: createRestrictedEditorExtensions("body", { equationStartCounts: counts, knownLabels: labels }),
      content: structuredBodyToTiptap([second, "参见{{eq:eq-second001}}。"], { equationStartCounts: counts, knownLabels: labels }),
    })
    expect(editor.getHTML()).toContain("(1-2)")
    editor.destroy()
  })
  it("turns $...$ into editable inline math at the cursor", async () => {
    const onChange = vi.fn()
    const { container } = render(<StructuredContentEditor value={["计算结果为 "]} onChange={onChange} enableProcessEquations />)
    const editor = (container.querySelector(".tiptap") as HTMLElement & { editor?: Editor }).editor!
    editor.commands.insertContentAt(1, "$x+1$")
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls.at(-1)?.[0][0].runs[0]).toMatchObject({ type: "inline_equation", alt: "x+1" })
    fireEvent.click(await screen.findByRole("button", { name: "编辑行内公式" }))
    fireEvent.change(screen.getByRole("textbox", { name: "编辑行内公式源码" }), { target: { value: "x^2" } })
    fireEvent.keyDown(screen.getByRole("textbox", { name: "编辑行内公式源码" }), { key: "Enter" })
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0][0].runs[0].expression.type).toBe("superscript"))
    expect(container.querySelector("math msup")).not.toBeNull()
  })
  it("supports display math in body paragraphs but keeps it as source in paragraph-only sections", () => {
    const editor = new Editor({ extensions: createRestrictedEditorExtensions("body", {}, true), content: structuredBodyToTiptap(["普通段落"]) })
    editor.commands.insertContentAt({ from: 0, to: editor.state.doc.content.size }, { type: "paragraph", content: [{ type: "text", text: "$$\\frac{a}{b}$$" }] })
    expect(tiptapToStructuredBody(editor.getJSON())[0]).toMatchObject({ type: "equation", expression: { type: "fraction" } })
    editor.destroy()
    const paragraphs = new Editor({ extensions: createRestrictedEditorExtensions("paragraphs", {}, true), content: structuredBodyToTiptap(["普通段落"]) })
    paragraphs.commands.insertContentAt({ from: 0, to: paragraphs.state.doc.content.size }, { type: "paragraph", content: [{ type: "text", text: "$$x^2$$" }] })
    expect(tiptapToStructuredBody(paragraphs.getJSON())).toEqual(["$$x^2$$"])
    paragraphs.destroy()
  })
  it("converts multiline display math and additional inline math beside an existing formula", () => {
    const editor = new Editor({ extensions: createRestrictedEditorExtensions("body", {}, true), content: structuredBodyToTiptap(["前文"]) })
    editor.commands.insertContentAt({ from: 0, to: editor.state.doc.content.size }, [
      { type: "paragraph", content: [{ type: "text", text: "$$" }] },
      { type: "paragraph", content: [{ type: "text", text: "x^2+\\sqrt{a}" }] },
      { type: "paragraph", content: [{ type: "text", text: "$$" }] },
    ])
    expect(tiptapToStructuredBody(editor.getJSON())[0]).toMatchObject({ type: "equation" })
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: "paragraph", content: [{ type: "text", text: "$a$ 和 $b$" }] })
    const last = tiptapToStructuredBody(editor.getJSON()).at(-1)
    expect(last).toMatchObject({ type: "paragraph", runs: [
      { type: "inline_equation", alt: "a" },
      { text: " 和 " },
      { type: "inline_equation", alt: "b" },
    ] })
    editor.destroy()
  })
  it("undoes source insertion and its live-preview conversion together", () => {
    const editor = new Editor({ extensions: createRestrictedEditorExtensions("body", {}, true), content: structuredBodyToTiptap(["前文"]) })
    editor.commands.insertContentAt(3, "$x^2$")
    expect(JSON.stringify(tiptapToStructuredBody(editor.getJSON()))).toContain("inline_equation")
    editor.commands.undo()
    expect(tiptapToStructuredBody(editor.getJSON())).toEqual(["前文"])
    editor.destroy()
  })
  it("keeps optional display-equation numbering available when editing source", async () => {
    const onChange = vi.fn()
    const block = { type: "equation" as const, expression: { type: "text" as const, value: "x" }, alt: "x" }
    render(<StructuredContentEditor value={[block]} onChange={onChange} enableProcessEquations />)
    fireEvent.click(screen.getByRole("button", { name: "编辑行间公式" }))
    fireEvent.click(screen.getByRole("button", { name: "编号与引用" }))
    fireEvent.change(screen.getByRole("spinbutton", { name: "公式所属章" }), { target: { value: "2" } })
    fireEvent.keyDown(screen.getByRole("textbox", { name: "编辑行间公式源码" }), { key: "Enter", metaKey: true })
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0][0]).toMatchObject({ type: "equation", chapter: 2, id: expect.stringMatching(/^eq-/) }))
  })
  it("preserves an unsupported edit as visible source instead of exporting stale math", async () => {
    const onChange = vi.fn()
    const inline = { type: "inline_equation" as const, expression: { type: "text" as const, value: "x" }, alt: "x" }
    render(<StructuredContentEditor value={[{ type: "paragraph", runs: [{ text: "公式 " }, inline] }]} onChange={onChange} enableProcessEquations />)
    fireEvent.click(await screen.findByRole("button", { name: "编辑行内公式" }))
    const source = screen.getByRole("textbox", { name: "编辑行内公式源码" })
    fireEvent.change(source, { target: { value: "\\unknown{x}" } })
    fireEvent.blur(source)
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0][0]).toBe("公式 $\\unknown{x}$"))
    expect(screen.getByText(/公式尚未完成或写法不受支持/)).toBeInTheDocument()
  })
  it("round-trips table styles, rich cells, image order and layouts through actual editor and HTML", () => {
    const value = [table, group]
    expect(isStructuredBodyValue(value)).toBe(true)
    const editor = new Editor({ extensions: createRestrictedEditorExtensions("body"), content: structuredBodyToTiptap(value) })
    expect(tiptapToStructuredBody(editor.getJSON())).toEqual(value)
    const restored = new Editor({ extensions: createRestrictedEditorExtensions("body"), content: editor.getHTML() })
    expect(tiptapToStructuredBody(restored.getJSON())).toEqual(value)
    expect(structuredFigureCatalog(value)).toMatchObject([{ id: group.id, label: "图 2-1" }])
    editor.destroy(); restored.destroy()
  })
  it("inserts at the captured cursor, undoes and redoes the whole block", () => {
    const editor = new Editor({ extensions: createRestrictedEditorExtensions("body"), content: structuredBodyToTiptap(["前文", "后文"]) })
    editor.commands.insertContentAt(4, structuredBodyToTiptap([group]).content!)
    expect(tiptapToStructuredBody(editor.getJSON())).toEqual(["前文", group, "后文"])
    editor.commands.undo()
    expect(tiptapToStructuredBody(editor.getJSON())).toEqual(["前文", "后文"])
    editor.commands.redo()
    expect(tiptapToStructuredBody(editor.getJSON())).toEqual(["前文", group, "后文"])
    editor.destroy()
  })
  it("keeps rich cell data and column settings when confirming unchanged table", () => {
    const onSave = vi.fn()
    render(<BodyToolDialog value={table} chapters={[]} onCancel={vi.fn()} onSave={onSave} />)
    fireEvent.click(screen.getByRole("button", { name: "确认三线表" }))
    expect(onSave).toHaveBeenCalledWith(table)
  })
  it("reorders a group and cancellation never writes document data", () => {
    const onSave = vi.fn(), onCancel = vi.fn()
    render(<BodyToolDialog value={group} chapters={[{ value: 2, label: "第 2 章" }]} onCancel={onCancel} onSave={onSave} />)
    fireEvent.click(screen.getAllByRole("button", { name: "后移" })[0])
    expect(screen.getAllByRole("img")[0]).toHaveAttribute("alt", "图片 1")
    fireEvent.click(screen.getByRole("button", { name: "取消" }))
    expect(onCancel).toHaveBeenCalledOnce(); expect(onSave).not.toHaveBeenCalled()
    expect(group.items[0].alt).toBe("图片 0")
  })
  it("offers insertion and allows reopening, cancelling, and deleting an existing table", async () => {
    const onChange = vi.fn()
    const { container } = render(<StructuredContentEditor value={[table]} onChange={onChange} enableFigures enableDocumentTools />)
    expect(screen.getByRole("button", { name: "插入图表" })).toBeEnabled()
    fireEvent.click(container.querySelector("figure[data-table-block]")!)
    // ProseMirror's node selection is driven by its real editor view.
    const view = (container.querySelector(".tiptap") as HTMLElement & { editor?: Editor }).editor
    expect(view).toBeDefined()
    view!.commands.setNodeSelection(0)
    await waitFor(() => expect(screen.getByRole("button", { name: "编辑图表" })).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: "编辑图表" }))
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "取消" }))
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "删除图表" }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([]))
  })
})
