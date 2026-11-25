import { describe, expect, it } from "vitest"
import { assessmentContent, assessmentStarterParagraphs, assessmentWritingGuidance, assessmentDocumentRegistry, assessmentGradeError, emptyAssessmentDraft, isAssessmentDocumentType, moveAssessmentItem, readAssessmentDraft } from "./assessment-documents"

describe("assessment document input", () => {
  it("starts with blank lower regions and preserves the shared metadata", () => {
    const content = assessmentContent(emptyAssessmentDraft(), { title: "合成论文", student_name: "示例学生" })
    expect(content.metadata).toMatchObject({ title: "合成论文", student_name: "示例学生", reviewer: "", defense_time: "" })
    expect(content.sections).toEqual({ editable_headings: false, writing_guidance: { comments: null, division_of_work: null, questions: null }, comments: [], division_of_work: [], suggested_grade: "", questions: [], members: [], final_grade: "", date: "" })
  })

  it("round trips independent reviewer, rich review, question pairs and members", () => {
    const input = { ...emptyAssessmentDraft(), reviewer: "示例评阅人", reviewerTitle: "教授", comments: [{ type: "paragraph" as const, runs: [{ text: "合成", bold: true }, { text: "2", script: "sub" as const }] }], questions: [{ question: ["合成问题"], answer: ["合成回答"] }], members: ["示例成员"], suggestedGrade: "优", finalGrade: "89.5" }
    const content = assessmentContent(input, { advisor: "示例导师" })
    expect(readAssessmentDraft(content.metadata as Record<string, unknown>, content.sections as Record<string, unknown>)).toEqual(input)
    expect(content.metadata).toMatchObject({ advisor: "示例导师", reviewer: "示例评阅人" })
  })

  it("supports four independent types with centralized editing permissions", () => {
    expect(Object.keys(assessmentDocumentRegistry)).toEqual(["advisor_review", "reviewer_review", "defense_record", "grade_assessment"])
    expect(Object.values(assessmentDocumentRegistry).every(entry => entry.lowerEditingEnabled)).toBe(true)
    expect(isAssessmentDocumentType("advisor_review")).toBe(true)
    expect(isAssessmentDocumentType("proposal")).toBe(false)
    expect(isAssessmentDocumentType(null)).toBe(false)
  })

  it.each(["advisor_review", "reviewer_review", "defense_record", "grade_assessment"] as const)("seeds %s guidance separately from existing body and preserves deletion on reopen", type => {
    const original = { comments: ["原有正文"], division_of_work: ["原有分工"] }
    const migrated = readAssessmentDraft({}, original, type)
    expect(migrated.comments).toEqual(["原有正文"])
    expect(migrated.divisionOfWork).toEqual(["原有分工"])
    expect(migrated.writingGuidance).toEqual({ comments: type === "defense_record" ? null : assessmentWritingGuidance[type], divisionOfWork: type === "advisor_review" ? assessmentWritingGuidance.divisionOfWork : null, questions: type === "defense_record" ? assessmentWritingGuidance.defense_record : null })
    expect(original.comments).toEqual(["原有正文"])
    const deleted = { ...migrated, writingGuidance: { comments: null, divisionOfWork: null, questions: null } }
    const stored = assessmentContent(deleted, {})
    expect(readAssessmentDraft({}, stored.sections as Record<string, unknown>, type)).toEqual(deleted)
  })

  it.each(["advisor_review", "reviewer_review", "defense_record", "grade_assessment"] as const)("migrates recognized v1 %s headings without duplicating fixed labels", type => {
    const input = { editable_headings: true, comments: [assessmentStarterParagraphs[type], "已保存的正文"], division_of_work: [assessmentStarterParagraphs.divisionOfWork, "已保存的分工"] }
    const migrated = readAssessmentDraft({}, input, type)
    expect(migrated.comments).toEqual(["已保存的正文"])
    expect(migrated.writingGuidance[type === "defense_record" ? "questions" : "comments"]).toBe(assessmentWritingGuidance[type])
    expect(migrated.divisionOfWork).toEqual(type === "advisor_review" ? ["已保存的分工"] : input.division_of_work)
    expect(input.comments).toEqual([assessmentStarterParagraphs[type], "已保存的正文"])
  })

  it("trims known fixed labels and suffixes while preserving rich guide runs", () => {
    const first = { runs: [{ text: "指导教师", bold: true }, { text: "评语（修改", italic: true }, { text: "后的说明）：", script: "sub" as const }] }
    const migrated = readAssessmentDraft({}, { editable_headings: true, comments: [first, "后续正文"] }, "advisor_review")
    expect(migrated.comments).toEqual(["后续正文"])
    expect(migrated.writingGuidance.comments).toEqual({ runs: [{ text: "（修改", italic: true }, { text: "后的说明）", script: "sub" }] })
    expect(first.runs[0].text).toBe("指导教师")
  })

  it.each(["advisor_review", "reviewer_review", "defense_record", "grade_assessment"] as const)("keeps unrecognized and deleted v1 %s text without guessing or restoring a guide", type => {
    const custom = [{ runs: [{ text: "我自己的意见", bold: true }] }, "下一段正文"]
    const migrated = readAssessmentDraft({}, { editable_headings: true, comments: custom, division_of_work: ["我自己的分工"] }, type)
    expect(migrated.comments).toEqual(custom)
    expect(migrated.divisionOfWork).toEqual(["我自己的分工"])
    expect(migrated.writingGuidance).toEqual({ comments: null, divisionOfWork: null, questions: null })
    expect(readAssessmentDraft({}, { editable_headings: true, comments: [] }, type).writingGuidance).toEqual({ comments: null, divisionOfWork: null, questions: null })
  })

  it.each([null, "", { runs: [] }, { runs: [{ text: "" }] }])("treats an explicit empty v2 guide %j as deletion and never re-seeds it", deleted => {
    const sections = { comments: ["原有正文"], writing_guidance: { comments: deleted, division_of_work: deleted, questions: deleted } }
    const read = readAssessmentDraft({}, sections, "advisor_review")
    expect(read.comments).toEqual(["原有正文"])
    expect(read.writingGuidance).toEqual({ comments: null, divisionOfWork: null, questions: null })
    expect(readAssessmentDraft({}, { writing_guidance: {} }, "advisor_review").writingGuidance.comments).toBeNull()
  })

  it("round trips marked guidance independently of rich body and question pairs", () => {
    const input = { ...emptyAssessmentDraft(), writingGuidance: { comments: { runs: [{ text: "（我的说明）", bold: true }] }, divisionOfWork: null, questions: "自定义答辩引导" }, comments: ["正文"], questions: [{ question: ["问题"], answer: ["回答"] }] }
    const content = assessmentContent(input, {})
    expect(readAssessmentDraft({}, content.sections as Record<string, unknown>, "defense_record")).toEqual({ ...input, editableHeadings: true })
  })

  it("moves question pairs together and does not mutate saved input", () => {
    const input = [{ question: "甲", answer: "甲答" }, { question: "乙", answer: "乙答" }]
    expect(moveAssessmentItem(input, 0, 1)).toEqual([input[1], input[0]])
    expect(input[0].question).toBe("甲")
    expect(moveAssessmentItem(input, 0, -1)).toBe(input)
  })

  it("allows blank and nonnegative decimal final grades without inventing a scoring scale", () => {
    for (const value of ["", " ", "0", "89.5", "100.5", "1000"]) expect(assessmentGradeError(value)).toBeNull()
    for (const value of [".5", "-1", "优", "NaN", "Infinity", "1e4", "9".repeat(310)]) expect(assessmentGradeError(value)).not.toBeNull()
  })
  it("preserves editor placeholders in saved input for the render boundary to normalize", () => {
    const input = { ...emptyAssessmentDraft(), members: ["", " ", "示例成员"], questions: [{ question: [""], answer: [] }, { question: [], answer: ["单侧回答"] }] }
    const content = assessmentContent(input, {})
    expect(content.sections).toMatchObject({ members: input.members, questions: input.questions })
    expect(input.members).toEqual(["", " ", "示例成员"])
    expect(input.questions).toHaveLength(2)
  })

})
