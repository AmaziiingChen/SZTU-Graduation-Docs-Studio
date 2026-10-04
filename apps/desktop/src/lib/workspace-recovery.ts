import { isParagraphInput, isStructuredBodyValue } from "@/lib/structured-content-editor"
import { readThesisDraft } from "@/lib/thesis-draft"
import type { DocumentType, JsonObject, StudentProfileDraft } from "@/types/desktop-api"

export type WorkspaceRecovery = {
  version: 1
  documentId: string
  documentType: DocumentType
  capturedAt: string
  content: JsonObject
  profileDraft: StudentProfileDraft
}

const documentTypes = new Set<DocumentType>([
  "proposal", "task_book", "midterm", "thesis", "advisor_review",
  "reviewer_review", "defense_record", "grade_assessment",
])

const profileTextFields = [
  "full_name", "student_number", "college", "major", "class_name",
  "advisor_name", "advisor_title", "graduation_cohort",
] as const

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function validContent(content: unknown, type: DocumentType): content is JsonObject {
  if (!record(content) || !record(content.metadata)) return false
  if (type === "thesis") {
    try { readThesisDraft(content.thesis); return content.thesis !== undefined } catch { return false }
  }
  const sections = content.sections
  if (!record(sections)) return false
  const bodyFields = type === "proposal"
    ? ["significance_and_status", "research_content", "methods_and_means", "research_steps"]
    : type === "task_book"
      ? ["basic_content_and_requirements", "required_materials"]
      : type === "midterm"
        ? ["main_research_content", "progress"]
        : ["comments", "division_of_work"]
  if (!bodyFields.every(field => isStructuredBodyValue(sections[field]))) return false
  if (type === "proposal" || type === "task_book") {
    if (!Array.isArray(sections.references) || !sections.references.every(isParagraphInput)) return false
  }
  if (type === "task_book") {
    return Array.isArray(sections.schedule) && sections.schedule.every(item =>
      record(item) && typeof item.period === "string" && isParagraphInput(item.content),
    ) && record(sections.topic_information)
  }
  if (type === "midterm") {
    return Array.isArray(sections.directory) && sections.directory.every(item =>
      record(item) && Number.isInteger(item.level) && Number(item.level) >= 1 &&
      Number(item.level) <= 3 && isParagraphInput(item.title) &&
      (item.number === undefined || typeof item.number === "string"),
    )
  }
  if (type !== "proposal") {
    return Array.isArray(sections.questions) && sections.questions.every(item =>
      record(item) && isStructuredBodyValue(item.question) && isStructuredBodyValue(item.answer),
    ) && Array.isArray(sections.members) && sections.members.every(item => typeof item === "string") &&
      ["suggested_grade", "final_grade", "date"].every(field => typeof sections[field] === "string") &&
      record(sections.writing_guidance) &&
      ["comments", "division_of_work", "questions"].every(field =>
        sections.writing_guidance && record(sections.writing_guidance) &&
        (sections.writing_guidance[field] === null || isParagraphInput(sections.writing_guidance[field])),
      )
  }
  return true
}

function validRecovery(value: unknown, documentId: string, documentType: DocumentType): value is WorkspaceRecovery {
  if (!record(value) || value.version !== 1 || value.documentId !== documentId ||
    value.documentType !== documentType || !documentTypes.has(documentType) ||
    typeof value.capturedAt !== "string" || !Number.isFinite(Date.parse(value.capturedAt)) ||
    !validContent(value.content, documentType) || !record(value.profileDraft)) return false
  const profile = value.profileDraft
  return profileTextFields.every(field => typeof profile[field] === "string") &&
    (profile.thesis_title_en === null || typeof profile.thesis_title_en === "string") &&
    (profile.thesis_title === null ||
      (Array.isArray(profile.thesis_title) && profile.thesis_title.every(isParagraphInput)))
}

export function workspaceRecoveryKey(documentId: string): string {
  return `sztu.workspace-recovery.v1:${encodeURIComponent(documentId)}`
}

export function readWorkspaceRecovery(documentId: string, documentType: DocumentType): WorkspaceRecovery | null {
  try {
    const source = window.localStorage.getItem(workspaceRecoveryKey(documentId))
    if (!source) return null
    const recovery: unknown = JSON.parse(source)
    return validRecovery(recovery, documentId, documentType) ? recovery : null
  } catch { return null }
}

export function writeWorkspaceRecovery(recovery: WorkspaceRecovery): void {
  if (!validRecovery(recovery, recovery.documentId, recovery.documentType)) {
    throw new Error("当前草稿无法完整保留，已取消重新载入。请先复制需要保留的内容。")
  }
  try {
    const source = JSON.stringify(recovery)
    const key = workspaceRecoveryKey(recovery.documentId)
    window.localStorage.setItem(key, source)
    if (window.localStorage.getItem(key) !== source) throw new Error("Recovery verification failed.")
  } catch {
    throw new Error("无法在本机保留当前草稿，已取消重新载入。请先复制需要保留的内容。")
  }
}

export function removeWorkspaceRecovery(recovery: WorkspaceRecovery): boolean {
  try {
    const key = workspaceRecoveryKey(recovery.documentId)
    const current = readWorkspaceRecovery(recovery.documentId, recovery.documentType)
    if (!current || current.capturedAt !== recovery.capturedAt) return false
    window.localStorage.removeItem(key)
    return window.localStorage.getItem(key) === null
  } catch { return false }
}
