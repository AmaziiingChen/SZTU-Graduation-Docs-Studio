import type { DocumentType, JsonObject } from "@/types/desktop-api"
import { isParagraphInput } from "@/lib/structured-content-editor"
import type { ParagraphInput, ParagraphRun, StructuredBodyValue } from "@/types/structured-content"

export const assessmentDocumentRegistry = {
  advisor_review: { label: "指导教师评审表", lowerEditingEnabled: true },
  reviewer_review: { label: "评阅人评审表", lowerEditingEnabled: true },
  defense_record: { label: "答辩记录表", lowerEditingEnabled: true },
  grade_assessment: { label: "成绩考核表", lowerEditingEnabled: true },
} satisfies Partial<Record<DocumentType, { label: string; lowerEditingEnabled: boolean }>>

export type AssessmentDocumentType = keyof typeof assessmentDocumentRegistry
export function isAssessmentDocumentType(value: unknown): value is AssessmentDocumentType {
  return typeof value === "string" && Object.hasOwn(assessmentDocumentRegistry, value)
}

/** Original v1 paragraphs, used only to recognize existing drafts during migration. */
export const assessmentStarterParagraphs = {
  advisor_review: "指导教师评语（从选题价值和难度、工作量、工作态度、材料翔实性与论证严密性、创新性、撰写水平与规范性等方面进行评述）：",
  reviewer_review: "评阅教师评语（从选题价值和难度、工作量、材料翔实性与论证严密性、创新性、撰写的水平与规范性等方面进行评述）：",
  defense_record: "答辩小组（学院答辩委员会）对学生毕业设计（论文）的陈述提出的问题及学生的回答情况：",
  grade_assessment: "答辩小组意见：（从选题价值和难度、工作量、工作态度、论文的创新性、论证的严密性和论文撰写规范性、答辩中表现等方面给予评价）",
  divisionOfWork: "毕业论文（设计）的分工情况：（合作一个论文（设计）题目时填写）",
} as const

function paragraphText(value: StructuredBodyValue[number]): string {
  if (typeof value === "string") return value
  if ("runs" in value) return value.runs.map(run => "text" in run ? run.text : run.alt).join("")
  return ""
}

export const assessmentWritingGuidance = {
  advisor_review: "（从选题价值和难度、工作量、工作态度、材料翔实性与论证严密性、创新性、撰写水平与规范性等方面进行评述）",
  reviewer_review: "（从选题价值和难度、工作量、材料翔实性与论证严密性、创新性、撰写的水平与规范性等方面进行评述）",
  defense_record: assessmentStarterParagraphs.defense_record,
  grade_assessment: "（从选题价值和难度、工作量、工作态度、论文的创新性、论证的严密性和论文撰写规范性、答辩中表现等方面给予评价）",
  divisionOfWork: "（合作一个论文（设计）题目时填写）",
} as const

export type AssessmentWritingGuidance = { comments: ParagraphInput | null; divisionOfWork: ParagraphInput | null; questions: ParagraphInput | null }

function emptyWritingGuidance(): AssessmentWritingGuidance {
  return { comments: null, divisionOfWork: null, questions: null }
}

function readGuidance(value: unknown): ParagraphInput | null {
  return isParagraphInput(value) && paragraphText(value).trim() ? structuredClone(value) : null
}

/** Trim recognized fixed labels without discarding formatting on the remaining text. */
function sliceParagraph(value: ParagraphInput, start: number, end: number): ParagraphInput | undefined {
  if (typeof value === "string") return value.slice(start, end)
  let offset = 0
  const runs: ParagraphRun[] = []
  for (const run of value.runs) {
    const text = "text" in run ? run.text : run.alt
    const left = Math.max(0, start - offset)
    const right = Math.min(text.length, end - offset)
    if (right > left) {
      if ("text" in run) runs.push({ ...run, text: text.slice(left, right) })
      else if (left === 0 && right === text.length) runs.push(structuredClone(run))
      else return undefined
    }
    offset += text.length
  }
  return { ...value, runs }
}

function migrateEditableGuidance(body: StructuredBodyValue, type: AssessmentDocumentType | "divisionOfWork"): { body: StructuredBodyValue; guidance: ParagraphInput | null } {
  const first = body[0]
  if (!isParagraphInput(first)) return { body, guidance: null }
  const text = paragraphText(first)
  if (type === "defense_record") return text === assessmentStarterParagraphs.defense_record
    ? { body: body.slice(1), guidance: readGuidance(first) } : { body, guidance: null }
  const prefix = { advisor_review: "指导教师评语", reviewer_review: "评阅教师评语", grade_assessment: "答辩小组意见：", divisionOfWork: "毕业论文（设计）的分工情况：" }[type]
  if (!text.startsWith(prefix)) return { body, guidance: null }
  const hasFixedSuffix = (type === "advisor_review" || type === "reviewer_review") && text.endsWith("：")
  const guidance = sliceParagraph(first, prefix.length, text.length - (hasFixedSuffix ? 1 : 0))
  return guidance === undefined ? { body, guidance: null } : { body: body.slice(1), guidance: readGuidance(guidance) }
}

export type AssessmentDraft = {
  editableHeadings: boolean
  writingGuidance: AssessmentWritingGuidance
  reviewer: string
  reviewerTitle: string
  defenseTime: string
  defenseLocation: string
  recorder: string
  leader: string
  comments: StructuredBodyValue
  divisionOfWork: StructuredBodyValue
  suggestedGrade: string
  questions: { question: StructuredBodyValue; answer: StructuredBodyValue }[]
  members: string[]
  finalGrade: string
  date: string
}

export function emptyAssessmentDraft(): AssessmentDraft {
  return { editableHeadings: false, writingGuidance: emptyWritingGuidance(), reviewer: "", reviewerTitle: "", defenseTime: "", defenseLocation: "", recorder: "", leader: "", comments: [], divisionOfWork: [], suggestedGrade: "", questions: [], members: [], finalGrade: "", date: "" }
}

export function readAssessmentDraft(metadata: Record<string, unknown>, sections: Record<string, unknown>, type?: AssessmentDocumentType): AssessmentDraft {
  const text = (value: unknown) => typeof value === "string" ? value : ""
  const body = (value: unknown): StructuredBodyValue => Array.isArray(value) ? structuredClone(value) as StructuredBodyValue : []
  const editableHeadings = sections.editable_headings === true
  let comments = body(sections.comments)
  let divisionOfWork = body(sections.division_of_work)
  const writingGuidance = emptyWritingGuidance()
  if (Object.hasOwn(sections, "writing_guidance")) {
    const map = sections.writing_guidance && typeof sections.writing_guidance === "object" && !Array.isArray(sections.writing_guidance) ? sections.writing_guidance as Record<string, unknown> : {}
    writingGuidance.comments = readGuidance(map.comments)
    writingGuidance.divisionOfWork = readGuidance(map.division_of_work)
    writingGuidance.questions = readGuidance(map.questions)
  } else if (type) {
    const field = type === "defense_record" ? "questions" : "comments"
    if (editableHeadings) {
      const migrated = migrateEditableGuidance(comments, type)
      comments = migrated.body
      writingGuidance[field] = migrated.guidance
      if (type === "advisor_review") {
        const division = migrateEditableGuidance(divisionOfWork, "divisionOfWork")
        divisionOfWork = division.body
        writingGuidance.divisionOfWork = division.guidance
      }
    } else {
      writingGuidance[field] = assessmentWritingGuidance[type]
      if (type === "advisor_review") writingGuidance.divisionOfWork = assessmentWritingGuidance.divisionOfWork
    }
  }
  return {
    editableHeadings: editableHeadings || !!type,
    writingGuidance,
    reviewer: text(metadata.reviewer), reviewerTitle: text(metadata.reviewer_title),
    defenseTime: text(metadata.defense_time), defenseLocation: text(metadata.defense_location),
    recorder: text(metadata.recorder), leader: text(metadata.leader),
    comments,
    divisionOfWork,
    suggestedGrade: text(sections.suggested_grade), finalGrade: text(sections.final_grade), date: text(sections.date),
    members: Array.isArray(sections.members) ? sections.members.filter((value): value is string => typeof value === "string") : [],
    questions: Array.isArray(sections.questions) ? sections.questions.flatMap(value =>
      value && typeof value === "object" && !Array.isArray(value)
        ? [{ question: body((value as Record<string, unknown>).question), answer: body((value as Record<string, unknown>).answer) }] : []) : [],
  }
}

/** An editing permission only; disabling it must never erase stored input or alter exports. */
export function assessmentContent(draft: AssessmentDraft, sharedMetadata: JsonObject): JsonObject {
  return {
    metadata: { ...sharedMetadata, reviewer: draft.reviewer, reviewer_title: draft.reviewerTitle, defense_time: draft.defenseTime, defense_location: draft.defenseLocation, recorder: draft.recorder, leader: draft.leader },
    sections: { editable_headings: draft.editableHeadings, writing_guidance: { comments: structuredClone(draft.writingGuidance.comments), division_of_work: structuredClone(draft.writingGuidance.divisionOfWork), questions: structuredClone(draft.writingGuidance.questions) }, comments: structuredClone(draft.comments), division_of_work: structuredClone(draft.divisionOfWork), suggested_grade: draft.suggestedGrade, questions: structuredClone(draft.questions), members: [...draft.members], final_grade: draft.finalGrade, date: draft.date },
  } as unknown as JsonObject
}

export function moveAssessmentItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction
  if (target < 0 || target >= items.length) return items
  const next = [...items]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function assessmentGradeError(value: string): string | null {
  if (!value.trim()) return null
  return /^\d+(?:\.\d+)?$/.test(value.trim()) && Number(value) >= 0 && Number.isFinite(Number(value))
    ? null : "请输入非负整数或小数（例如 0.5），或留空由现场填写。"
}
