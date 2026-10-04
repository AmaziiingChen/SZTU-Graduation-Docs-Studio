import { describe, expect, it } from "vitest"
import { parseTelemetryUsageEvent } from "../electron/telemetry"

describe("assessment telemetry boundary", () => {
  it.each(["advisor_review", "reviewer_review", "defense_record", "grade_assessment"])("accepts the %s type for view and document operations", documentType => {
    expect(parseTelemetryUsageEvent({ name: "view_opened", view: documentType })).toEqual({ name: "view_opened", view: documentType })
    const event = { name: "document_action", action: "preview", documentType, outcome: "failure", errorCode: "SINGLE_PAGE_OVERFLOW" }
    expect(parseTelemetryUsageEvent(event)).toEqual(event)
  })
  it("continues to reject document content and unknown types", () => {
    expect(() => parseTelemetryUsageEvent({ name: "view_opened", view: "advisor_review", student_name: "隐私字段" })).toThrow()
    expect(() => parseTelemetryUsageEvent({ name: "document_action", action: "preview", documentType: "unknown_form", outcome: "success" })).toThrow()
  })
})
