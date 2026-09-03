import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

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

afterEach(cleanup)

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
