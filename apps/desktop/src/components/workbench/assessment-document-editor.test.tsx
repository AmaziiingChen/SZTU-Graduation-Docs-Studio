import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AssessmentDocumentEditor } from "./assessment-document-editor"
import { assessmentContent, emptyAssessmentDraft, readAssessmentDraft, type AssessmentDraft } from "@/lib/assessment-documents"
import type { ParagraphInput, StructuredBodyValue } from "@/types/structured-content"

vi.mock("@/components/workbench/structured-content-editor", () => ({
  StructuredContentEditor: ({ value, disabled, ariaLabel }: { value: StructuredBodyValue; disabled: boolean; ariaLabel: string }) => <textarea aria-label={ariaLabel} disabled={disabled} readOnly value={JSON.stringify(value)} />,
}))
afterEach(cleanup)

const common = { disabled: false, sharedInformation: [{ label: "姓名", value: "示例学生" }] }

describe("assessment editor", () => {
  it.each(["advisor_review", "reviewer_review", "defense_record", "grade_assessment"] as const)("preserves shared title marks and live changes in %s", type => {
    const title: ParagraphInput = { runs: [{ text: "ZrO" }, { text: "2", script: "sub" }, { text: " 与 Al" }, { text: "2", script: "sub" }, { text: "O" }, { text: "3", script: "sub" }, { text: " 的 x", italic: true }, { text: "2", script: "super", bold: true }, { text: " 研究", bold: true }] }
    const original = structuredClone(title)
    const props = { ...common, type, activeSection: "assessment_info", value: emptyAssessmentDraft(), onChange: vi.fn() }
    const { container, rerender } = render(<AssessmentDocumentEditor {...props} sharedInformation={[{ label: "论文题目", value: title }]} />)
    expect(Array.from(container.querySelectorAll("dd sub")).map(node => node.textContent)).toEqual(["2", "2", "3"])
    expect(container.querySelector("dd strong sup")).toHaveTextContent("2")
    expect(container.querySelector("dd em")).toHaveTextContent("x")
    expect(container.querySelector("dd")).toHaveTextContent("ZrO2 与 Al2O3 的 x2 研究")
    expect(title).toEqual(original)
    expect(props.onChange).not.toHaveBeenCalled()
    rerender(<AssessmentDocumentEditor {...props} sharedInformation={[{ label: "论文题目", value: { runs: [{ text: "新题目" }, { text: "3", script: "super" }] } }]} />)
    expect(container.querySelector("dd sup")).toHaveTextContent("3")
    expect(container.querySelector("dd sub")).toBeNull()
    rerender(<AssessmentDocumentEditor {...props} sharedInformation={[{ label: "论文题目", value: "纯文字题目" }]} />)
    expect(container.querySelector("dd")).toHaveTextContent("纯文字题目")
    rerender(<AssessmentDocumentEditor {...props} sharedInformation={[{ label: "论文题目", value: { runs: [] } }]} />)
    expect(container.querySelector("dd")).toHaveTextContent("未填写")
  })

  it("previews shared information and supports preset and custom reviewer titles", () => {
    const onChange = vi.fn()
    const props = { ...common, type: "reviewer_review" as const, activeSection: "assessment_info", onChange }
    const { rerender } = render(<AssessmentDocumentEditor {...props} value={emptyAssessmentDraft()} />)
    expect(screen.getByText("示例学生")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("评阅教师姓名"), { target: { value: "示例评阅教师" } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ reviewer: "示例评阅教师" }))
    rerender(<AssessmentDocumentEditor {...props} value={onChange.mock.lastCall![0]} />)
    const title = screen.getByRole("combobox", { name: "评阅教师职称" })
    const trigger = title.closest('[data-slot="input-group"]')!.querySelector("button")!
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole("option", { name: "教授" }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ reviewer: "示例评阅教师", reviewerTitle: "教授" }))
    rerender(<AssessmentDocumentEditor {...props} value={onChange.mock.lastCall![0]} />)
    fireEvent.change(screen.getByLabelText("评阅教师职称"), { target: { value: "研究员" } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ reviewer: "示例评阅教师", reviewerTitle: "研究员" }))
    rerender(<AssessmentDocumentEditor {...props} value={onChange.mock.lastCall![0]} disabled />)
    expect(screen.getByLabelText("评阅教师职称")).toHaveValue("研究员")
    expect(screen.getByLabelText("评阅教师职称")).toBeDisabled()
    expect(screen.getByLabelText("评阅教师姓名")).toBeDisabled()
  })

  it("locks lower editing while preserving display and exportable content", () => {
    const value = { ...emptyAssessmentDraft(), comments: ["已保存的评审意见"], suggestedGrade: "优" }
    const onChange = vi.fn()
    render(<AssessmentDocumentEditor {...common} type="advisor_review" activeSection="assessment_suggested_grade" value={value} onChange={onChange} lowerEditingEnabled={false} />)
    expect(screen.getByLabelText("日期")).toBeDisabled()
    expect(screen.getByLabelText("建议成绩")).toBeDisabled()
    expect(screen.getByLabelText("建议成绩")).toHaveValue("优")
    expect(value.comments).toEqual(["已保存的评审意见"])
    expect(onChange).not.toHaveBeenCalled()
  })

  it("keeps basic information editable when lower content is locked", () => {
    render(<AssessmentDocumentEditor {...common} type="defense_record" activeSection="assessment_info" value={emptyAssessmentDraft()} onChange={vi.fn()} lowerEditingEnabled={false} />)
    expect(screen.getByLabelText("答辩时间")).toBeEnabled()
    expect(screen.getByLabelText("答辩地点")).toBeEnabled()
  })

  it.each(["2026年6月1日", "2026-06-01"])("opens the existing calendar for saved defense date %s and preserves the export format", async defenseTime => {
    const onChange = vi.fn()
    const props = { ...common, type: "defense_record" as const, activeSection: "assessment_info", onChange }
    const value = { ...emptyAssessmentDraft(), defenseTime, defenseLocation: "合成答辩室", date: "2026-06-03" }
    const { container, rerender } = render(<AssessmentDocumentEditor {...props} value={value} />)
    expect(screen.getByRole("button", { name: "答辩时间", exact: true })).toHaveTextContent("2026年6月1日")
    expect(container.querySelector('input[type="date"]')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "答辩时间", exact: true }))
    const calendar = await screen.findByRole("grid")
    const day = Array.from(calendar.querySelectorAll("button")).find(button => button.textContent === "15")!
    fireEvent.click(day)
    expect(onChange).toHaveBeenLastCalledWith({ ...value, defenseTime: "2026年6月15日" })
    const content = assessmentContent(onChange.mock.lastCall![0], {})
    expect(readAssessmentDraft(content.metadata as Record<string, unknown>, content.sections as Record<string, unknown>).defenseTime).toBe("2026年6月15日")
    rerender(<AssessmentDocumentEditor {...props} value={onChange.mock.lastCall![0]} />)
    await waitFor(() => expect(screen.queryByRole("grid")).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: "答辩时间", exact: true }))
    fireEvent.click(await screen.findByRole("button", { name: "清空日期" }))
    expect(onChange).toHaveBeenLastCalledWith({ ...value, defenseTime: "" })
  })

  it("flags an invalid legacy defense time without modifying it, and respects disabled state", () => {
    const onChange = vi.fn()
    const props = { ...common, type: "defense_record" as const, activeSection: "assessment_info", onChange }
    const value = { ...emptyAssessmentDraft(), defenseTime: "13123" }
    const { rerender } = render(<AssessmentDocumentEditor {...props} value={value} />)
    expect(screen.getByRole("button", { name: "答辩时间", exact: true })).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByText('原答辩时间“13123”不是有效日期，请重新选择。')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    rerender(<AssessmentDocumentEditor {...props} value={value} disabled />)
    expect(screen.getByRole("button", { name: "答辩时间", exact: true })).toBeDisabled()
  })

  it("adds and deletes only the last defense member while retaining personnel and date", () => {
    const onChange = vi.fn()
    const value = { ...emptyAssessmentDraft(), members: ["成员甲", "成员乙"], recorder: "记录员", leader: "组长", date: "2026-10-03" }
    const props = { ...common, type: "defense_record" as const, activeSection: "assessment_members", onChange }
    const { rerender } = render(<AssessmentDocumentEditor {...props} value={value} />)
    fireEvent.click(screen.getByRole("button", { name: "添加答辩成员" }))
    expect(onChange).toHaveBeenLastCalledWith({ ...value, members: ["成员甲", "成员乙", ""] })
    rerender(<AssessmentDocumentEditor {...props} value={onChange.mock.lastCall![0]} />)
    fireEvent.change(screen.getByLabelText("答辩成员 3"), { target: { value: "成员丙" } })
    expect(onChange).toHaveBeenLastCalledWith({ ...value, members: ["成员甲", "成员乙", "成员丙"] })
    rerender(<AssessmentDocumentEditor {...props} value={onChange.mock.lastCall![0]} />)
    fireEvent.click(screen.getByRole("button", { name: "删除答辩成员" }))
    expect(onChange).toHaveBeenLastCalledWith(value)
    rerender(<AssessmentDocumentEditor {...props} value={{ ...value, members: [] }} />)
    expect(screen.getByRole("button", { name: "删除答辩成员" })).toBeDisabled()
    rerender(<AssessmentDocumentEditor {...props} value={value} lowerEditingEnabled={false} />)
    expect(screen.getByLabelText("答辩成员 1")).toBeDisabled()
    expect(screen.getByRole("button", { name: "添加答辩成员" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "删除答辩成员" })).toBeDisabled()
  })

  it.each([
    ["reviewer_review", "assessment_info", ["评阅教师姓名", "评阅教师职称"]],
    ["defense_record", "assessment_info", ["答辩时间", "答辩地点"]],
    ["defense_record", "assessment_members", ["答辩成员 1", "记录员姓名", "答辩组长姓名", "日期"]],
    ["advisor_review", "assessment_suggested_grade", ["建议成绩", "日期"]],
    ["grade_assessment", "assessment_grade", ["最终成绩", "日期"]],
  ] as const)("keeps %s %s fields in the same label/value rows without repeating the section heading", (type, activeSection, labels) => {
    const { container } = render(<AssessmentDocumentEditor {...common} type={type} activeSection={activeSection} value={{ ...emptyAssessmentDraft(), members: ["成员甲"] }} onChange={vi.fn()} />)
    for (const label of labels) {
      const field = screen.getByLabelText(label)
      const row = field.closest(".grid-cols-2")!
      expect(row).not.toBeNull()
      expect(row.querySelector("label")).toHaveTextContent(label)
    }
    expect(container.querySelector('[data-slot="card-header"]')).toBeNull()
  })

  it("adds, removes and moves complete question and answer pairs", () => {
    const value: AssessmentDraft = { ...emptyAssessmentDraft(), questions: [{ question: ["甲问"], answer: ["甲答"] }, { question: ["乙问"], answer: ["乙答"] }] }
    const onChange = vi.fn()
    render(<AssessmentDocumentEditor {...common} type="defense_record" activeSection="assessment_questions" value={value} onChange={onChange} />)
    fireEvent.click(screen.getByRole("button", { name: "下移问答 1" }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ questions: [value.questions[1], value.questions[0]] }))
    fireEvent.click(screen.getByRole("button", { name: "删除问答 1" }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ questions: [value.questions[1]] }))
    fireEvent.click(screen.getByRole("button", { name: "添加问答" }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ questions: [...value.questions, { question: [], answer: [] }] }))
  })

  it("preserves the grade value and shows field-level validation", () => {
    const props = { ...common, type: "grade_assessment" as const, activeSection: "assessment_grade", onChange: vi.fn() }
    const { rerender } = render(<AssessmentDocumentEditor {...props} value={{ ...emptyAssessmentDraft(), finalGrade: "89.5" }} />)
    expect(screen.getByLabelText("最终成绩")).toHaveValue("89.5")
    rerender(<AssessmentDocumentEditor {...props} value={{ ...emptyAssessmentDraft(), finalGrade: "-1" }} />)
    expect(screen.getByLabelText("最终成绩")).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByText("请输入非负整数或小数（例如 0.5），或留空由现场填写。")).toBeInTheDocument()
    rerender(<AssessmentDocumentEditor {...props} value={{ ...emptyAssessmentDraft(), finalGrade: ".5" }} />)
    expect(screen.getByLabelText("最终成绩")).toHaveAttribute("aria-invalid", "true")
    expect(screen.queryByText(/导出成绩：/)).not.toBeInTheDocument()
  })
})
