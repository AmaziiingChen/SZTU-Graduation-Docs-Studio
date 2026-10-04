import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AssessmentDocumentEditor } from "./assessment-document-editor"
import { emptyAssessmentDraft, type AssessmentDraft } from "@/lib/assessment-documents"
import type { StructuredBodyValue } from "@/types/structured-content"

vi.mock("@/components/workbench/structured-content-editor", () => ({
  StructuredContentEditor: ({ value, disabled, ariaLabel }: { value: StructuredBodyValue; disabled: boolean; ariaLabel: string }) => <textarea aria-label={ariaLabel} disabled={disabled} readOnly value={JSON.stringify(value)} />,
}))
afterEach(cleanup)

const common = { disabled: false, sharedInformation: [{ label: "姓名", value: "示例学生" }] }

describe("assessment editor", () => {
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
