import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useState } from "react"
import { toast } from "sonner"

import {
  validateTaskScheduleItems,
  type TaskScheduleEditorItem,
} from "@/lib/task-schedule"
import { paragraphInputText } from "@/lib/paragraph"

import { TaskScheduleEditor } from "./task-schedule-editor"

const items: TaskScheduleEditorItem[] = [
  { id: "one", period: "第1—2周", content: "完成文献调研。" },
  {
    id: "two",
    period: "第3—6周",
    content: {
      type: "paragraph",
      runs: [
        { text: "完成 H" },
        { text: "2", script: "sub" },
        { text: "O 模型。" },
      ],
    },
  },
]

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function LiveSchedule({ initial = items, onChange = vi.fn(), disabled = false }: { initial?: TaskScheduleEditorItem[]; onChange?: (items: TaskScheduleEditorItem[]) => void; disabled?: boolean }) {
  const [value, setValue] = useState(initial)
  return <TaskScheduleEditor value={value} onChange={next => { setValue(next); onChange(next) }} disabled={disabled} />
}

async function menuAction(index: number, action: string) {
  fireEvent.click(screen.getByRole("button", { name: `第 ${index} 项进度：更多操作` }))
  fireEvent.click(await screen.findByRole("menuitem", { name: action }))
}

describe("TaskScheduleEditor", () => {
  it("uses one shared inline editor for the selected schedule item", () => {
    render(<TaskScheduleEditor value={items} onChange={vi.fn()} />)

    expect(screen.getByLabelText("第 1 项时间范围")).toHaveValue("第1—2周")
    expect(screen.getByRole("textbox", { name: "第 1 项进度内容" })).toHaveTextContent(
      "完成文献调研。",
    )
    expect(
      screen.getByRole("button", { name: "拖动第 1 项进度调整顺序" }),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText("第 2 项时间范围")).toBeNull()
    fireEvent.click(
      screen.getByRole("button", { name: "编辑第 2 项进度内容" }),
    )
    expect(screen.queryByLabelText("第 1 项时间范围")).toBeNull()
    expect(screen.getByLabelText("第 2 项时间范围")).toHaveValue("第3—6周")
    expect(screen.getByRole("textbox", { name: "第 2 项进度内容" })).toHaveTextContent(
      "完成 H2O 模型。",
    )
    expect(screen.getAllByRole("toolbar")).toHaveLength(1)
  })

  it("adds a structured row instead of parsing a pipe-delimited textarea", () => {
    const onChange = vi.fn()
    render(<TaskScheduleEditor value={items} onChange={onChange} />)

    fireEvent.click(screen.getByRole("button", { name: "新增进度" }))

    const next = onChange.mock.calls[0][0] as TaskScheduleEditorItem[]
    expect(next).toHaveLength(3)
    expect(next[2]).toMatchObject({ period: "", content: "" })
  })

  it("edits in the original row, hides duplicate summaries and can collapse every item", () => {
    render(<LiveSchedule />)
    expect(screen.getAllByText("完成文献调研。")).toHaveLength(1)
    const body = screen.getByRole("textbox", { name: "第 1 项进度内容" })
    expect(body.closest("[data-sortable-id]")).toHaveAttribute("data-sortable-id", "one")
    fireEvent.click(screen.getByRole("button", { name: "收起第 1 项进度" }))
    expect(screen.queryByRole("textbox", { name: "第 1 项进度内容" })).toBeNull()
    expect(screen.getByRole("button", { name: "编辑第 1 项进度内容" })).toHaveTextContent("完成文献调研。")
  })

  it("focuses a new period, defers errors until blur, and tabs directly into its content", async () => {
    render(<LiveSchedule />)
    fireEvent.click(screen.getByRole("button", { name: "新增进度" }))
    const period = screen.getByRole("textbox", { name: "第 3 项时间范围" })
    const content = screen.getByRole("textbox", { name: "第 3 项进度内容" })
    await waitFor(() => expect(period).toHaveFocus())
    expect(screen.queryByText("缺少时间范围。")).toBeNull()
    expect(content).toHaveAttribute("aria-invalid", "false")
    fireEvent.keyDown(period, { key: "Tab" })
    expect(content).toHaveFocus()
    expect(screen.getByText("缺少时间范围。")).toBeInTheDocument()
    expect(screen.queryByText("缺少进度内容。")).toBeNull()
    fireEvent.blur(content, { relatedTarget: screen.getByRole("button", { name: "新增进度" }) })
    expect(screen.getByText("缺少进度内容。")).toBeInTheDocument()
  })

  it("keeps draggable roots as siblings when rows are collapsed, expanded or added", () => {
    const { container } = render(<LiveSchedule />)
    const assertSiblings = (count: number) => {
      const rows = Array.from(container.querySelectorAll("[data-sortable-id]"))
      expect(rows).toHaveLength(count)
      const parent = rows[0].parentElement!
      expect(parent).toHaveAttribute("aria-label", "进度安排")
      expect(Array.from(parent.children)).toEqual(rows)
      for (const row of rows) expect(row.parentElement).toBe(parent)
    }
    assertSiblings(2)
    fireEvent.click(screen.getByRole("button", { name: "收起第 1 项进度" }))
    assertSiblings(2)
    fireEvent.click(screen.getByRole("button", { name: "编辑第 2 项进度内容" }))
    assertSiblings(2)
    fireEvent.click(screen.getByRole("button", { name: "新增进度" }))
    assertSiblings(3)
  })

  it("focuses the content when opening an existing row instead of stealing focus for its period", async () => {
    render(<LiveSchedule />)
    fireEvent.click(screen.getByRole("button", { name: "编辑第 2 项进度内容" }))
    await waitFor(() => expect(screen.getByRole("textbox", { name: "第 2 项进度内容" })).toHaveFocus())
    expect(screen.getByRole("textbox", { name: "第 2 项进度内容" }).querySelector("sub")).toHaveTextContent("2")
  })

  it("keeps the active item while reordering through the menu", async () => {
    const onChange = vi.fn()
    render(<LiveSchedule onChange={onChange} />)
    await menuAction(1, "下移")
    expect(onChange).toHaveBeenLastCalledWith([items[1], items[0]])
    expect(screen.getByRole("textbox", { name: "第 2 项进度内容" })).toHaveTextContent("完成文献调研。")
    expect(screen.queryByRole("button", { name: "第 1 项进度：上移" })).toBeNull()
  })

  it("deletes an inactive item without changing the editor and restores it without losing later edits", async () => {
    const info = vi.spyOn(toast, "info")
    const onChange = vi.fn()
    render(<LiveSchedule onChange={onChange} />)
    await menuAction(2, "删除")
    expect(screen.getByRole("textbox", { name: "第 1 项进度内容" })).toHaveTextContent("完成文献调研。")
    fireEvent.change(screen.getByRole("textbox", { name: "第 1 项时间范围" }), { target: { value: "第1—3周" } })
    const undo = info.mock.calls.at(-1)?.[1]?.action as { onClick: () => void }
    act(() => undo.onClick())
    expect(onChange).toHaveBeenLastCalledWith([{ ...items[0], period: "第1—3周" }, items[1]])
    expect(screen.getByRole("textbox", { name: "第 1 项进度内容" })).toBeInTheDocument()
  })

  it("restores a deleted last item and preserves a replacement the user has already edited", async () => {
    const info = vi.spyOn(toast, "info")
    const onChange = vi.fn()
    render(<LiveSchedule initial={[items[1]]} onChange={onChange} />)
    await menuAction(1, "删除")
    const undo = info.mock.calls.at(-1)?.[1]?.action as { onClick: () => void }
    fireEvent.change(screen.getByRole("textbox", { name: "第 1 项时间范围" }), { target: { value: "第9周" } })
    act(() => undo.onClick())
    const restored = onChange.mock.calls.at(-1)![0] as TaskScheduleEditorItem[]
    expect(restored).toHaveLength(2)
    expect(restored[0]).toEqual(items[1])
    expect(restored[1].period).toBe("第9周")
  })

  it("does not restore a deletion into a newly loaded schedule", async () => {
    const info = vi.spyOn(toast, "info")
    const onChange = vi.fn()
    const view = render(<TaskScheduleEditor value={items} onChange={onChange} />)
    await menuAction(2, "删除")
    const undo = info.mock.calls.at(-1)?.[1]?.action as { onClick: () => void }
    view.rerender(<TaskScheduleEditor value={[{ id: "other-document", period: "第1周", content: "另一份安排" }]} onChange={onChange} />)
    onChange.mockClear()
    act(() => undo.onClick())
    expect(onChange).not.toHaveBeenCalled()
  })

  it("reveals untouched field errors after an explicit validation request", () => {
    const empty = [{ id: "empty", period: "", content: "" }]
    const view = render(<TaskScheduleEditor value={empty} onChange={vi.fn()} />)
    expect(screen.queryByText("缺少时间范围。")).toBeNull()
    view.rerender(<TaskScheduleEditor value={empty} onChange={vi.fn()} validationRequested />)
    expect(screen.getByText("缺少时间范围。")).toBeInTheDocument()
    expect(screen.getByText("缺少进度内容。")).toBeInTheDocument()
  })

  it("keeps all mutations disabled and shows field errors when requested by the caller", () => {
    render(<TaskScheduleEditor value={[{ id: "empty", period: "", content: "" }]} onChange={vi.fn()} disabled error="请检查进度安排。" />)
    expect(screen.getByRole("button", { name: "新增进度" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "第 1 项进度：更多操作" })).toBeDisabled()
    expect(screen.getByRole("textbox", { name: "第 1 项时间范围" })).toBeDisabled()
    expect(screen.getByText("缺少时间范围。")).toBeInTheDocument()
    expect(screen.getByText("缺少进度内容。")).toBeInTheDocument()
  })

})

describe("task schedule helpers", () => {
  it("keeps rich paragraph text and validates fields independently", () => {
    expect(paragraphInputText(items[1].content)).toBe("完成 H2O 模型。")
    expect(validateTaskScheduleItems(items)).toEqual([])
    expect(
      validateTaskScheduleItems([
        { id: "invalid", period: "", content: "" },
      ]),
    ).toEqual(["第 1 项缺少时间范围。", "第 1 项缺少进度内容。"])
  })
})
