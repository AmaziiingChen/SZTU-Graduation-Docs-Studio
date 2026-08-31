import { describe, expect, it } from "vitest"

import { checkNavigationTarget } from "@/lib/document-navigation"
import type { CheckResult } from "@/types/desktop-api"

function failedCheck(field?: string, code = "DOCUMENT_NOT_READY"): CheckResult {
  return {
    schema_version: "1.0",
    check_id: "content",
    gate: "content",
    status: "fail",
    blocking: true,
    message: "内容需要修改。",
    code,
    ...(field ? { details: { field } } : {}),
  }
}

describe("document check navigation", () => {
  it("maps document fields to their visible section", () => {
    expect(
      checkNavigationTarget(
        "proposal",
        failedCheck("sections.methods_and_means[0].runs"),
      ),
    ).toEqual({
      pane: "document",
      sectionId: "proposal_methods",
      selector: '[aria-label="研究方法与手段"]',
    })
    expect(
      checkNavigationTarget(
        "midterm",
        failedCheck("sections.directory[2].title"),
      )?.sectionId,
    ).toBe("midterm_directory")
  })

  it("maps shared metadata to the student profile", () => {
    expect(
      checkNavigationTarget(
        "task_book",
        failedCheck("metadata.student_id"),
      ),
    ).toEqual({ pane: "profile", selector: "#studentId" })
    expect(
      checkNavigationTarget(
        "task_book",
        failedCheck(undefined, "GRADUATION_YEAR_MISSING"),
      ),
    ).toEqual({ pane: "profile", selector: "#graduationCohort" })
  })

  it("returns null when a check has no actionable field", () => {
    expect(checkNavigationTarget("proposal", failedCheck())).toBeNull()
  })
})
