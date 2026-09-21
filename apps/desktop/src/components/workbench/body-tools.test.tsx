import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { Editor } from "@tiptap/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BodyToolDialog } from "@/components/workbench/body-tool-dialog"
import { StructuredContentEditor } from "@/components/workbench/structured-content-editor"
import { createRestrictedEditorExtensions, isStructuredBodyValue, structuredBodyToTiptap, structuredFigureCatalog, tiptapToStructuredBody } from "@/lib/structured-content-editor"
import type { StructuredDataTableBlock, StructuredFigureGroupBlock } from "@/types/structured-content"
const table: StructuredDataTableBlock = { type: "data_table", style: "three_line", columns: [{ header: "项目" }, { header: "结果", alignment: "right", width_weight: 2 }], rows: [{ cells: ["样本", { runs: [{ text: "10", bold: true }] }] }], caption: "测试表" }
const group: StructuredFigureGroupBlock = { type: "figure_group", id: "fig-tools_0001", chapter: 2, columns: 2, caption: "组合图", items: ["a", "b", "c", "d"].map((value, index) => ({ path: `/assets/${value.repeat(64)}.png`, alt: `图片 ${index}`, caption: `条件 ${index}` })) }
afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe("embedded body tools", () => {
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
