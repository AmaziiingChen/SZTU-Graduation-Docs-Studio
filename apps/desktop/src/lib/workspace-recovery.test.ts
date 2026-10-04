import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { assessmentContent, emptyAssessmentDraft } from "@/lib/assessment-documents"
import { emptyThesisDraft } from "@/lib/thesis-draft"
import {
  readWorkspaceRecovery, removeWorkspaceRecovery, workspaceRecoveryKey,
  writeWorkspaceRecovery, type WorkspaceRecovery,
} from "@/lib/workspace-recovery"

const recovery: WorkspaceRecovery = {
  version: 1,
  documentId: "synthetic-document-a",
  documentType: "proposal",
  capturedAt: "2026-10-03T12:00:00.000Z",
  profileDraft: {
    full_name: "虚构学生", student_number: "SYN-001", college: "示例学院", major: "示例专业",
    class_name: "示例班", advisor_name: "虚构教师", advisor_title: "讲师", graduation_cohort: "2026届",
    thesis_title: ["虚构论文"], thesis_title_en: "Synthetic Thesis",
  },
  content: {
    metadata: { title: "虚构论文" },
    sections: {
      significance_and_status: ["本地尚未保存的内容"], research_content: ["研究内容"],
      methods_and_means: ["方法"], research_steps: ["步骤"], references: ["合成文献"],
    },
  },
}

beforeEach(() => window.localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe("workspace recovery", () => {
  it("keeps document identities and document types isolated", () => {
    writeWorkspaceRecovery(recovery)
    expect(readWorkspaceRecovery(recovery.documentId, "proposal")).toEqual(recovery)
    expect(readWorkspaceRecovery(recovery.documentId, "task_book")).toBeNull()
    window.localStorage.setItem(workspaceRecoveryKey("synthetic-document-b"), JSON.stringify(recovery))
    expect(readWorkspaceRecovery("synthetic-document-b", "proposal")).toBeNull()
  })

  it.each([
    { version: 2 },
    { capturedAt: "invalid" },
    { profileDraft: { ...recovery.profileDraft, full_name: 123 } },
    { profileDraft: { ...recovery.profileDraft, thesis_title: [{ runs: [{ text: 123 }] }] } },
    { content: { metadata: {}, sections: { ...recovery.content.sections as object, research_content: [{ invalid: true }] } } },
  ])("rejects malformed local recovery without replacing it: %j", (patch) => {
    const key = workspaceRecoveryKey(recovery.documentId)
    const source = JSON.stringify({ ...recovery, ...patch })
    window.localStorage.setItem(key, source)
    expect(readWorkspaceRecovery(recovery.documentId, "proposal")).toBeNull()
    expect(window.localStorage.getItem(key)).toBe(source)
  })

  it("supports current assessment and thesis content contracts", () => {
    const assessment: WorkspaceRecovery = {
      ...recovery, documentType: "advisor_review",
      content: assessmentContent(emptyAssessmentDraft(), { title: "虚构论文", student_name: "虚构学生", student_id: "SYN-001", college: "示例学院", major: "示例专业", advisor: "", advisor_title: "" }),
    }
    writeWorkspaceRecovery(assessment)
    expect(readWorkspaceRecovery(recovery.documentId, "advisor_review")).toEqual(assessment)
    const thesis: WorkspaceRecovery = {
      ...recovery, documentType: "thesis", content: { metadata: {}, thesis: { ...emptyThesisDraft() } },
    }
    writeWorkspaceRecovery(thesis)
    expect(readWorkspaceRecovery(recovery.documentId, "thesis")).toEqual(thesis)
  })

  it("throws on storage failure so callers can preserve the live draft", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError") })
    expect(() => writeWorkspaceRecovery(recovery)).toThrow("已取消重新载入")
  })

  it("does not remove a newer recovery while clearing an acknowledged one", () => {
    const newer = { ...recovery, capturedAt: "2026-10-03T12:01:00.000Z" }
    writeWorkspaceRecovery(newer)
    expect(removeWorkspaceRecovery(recovery)).toBe(false)
    expect(readWorkspaceRecovery(recovery.documentId, "proposal")).toEqual(newer)
    expect(removeWorkspaceRecovery(newer)).toBe(true)
    expect(readWorkspaceRecovery(recovery.documentId, "proposal")).toBeNull()
  })
})
