import { describe, expect, it } from "vitest"

import { midtermDateIsAllowed, midtermDateRuleForCollege } from "./midterm-date-rules"

const rules = [{ college: "新材料与新能源学院", startDate: "2026-09-20", endDate: "2026-09-30" }]

describe("college-specific midterm dates", () => {
  it("uses the inclusive range only for the matching college", () => {
    const rule = midtermDateRuleForCollege(rules, " 新材料与新能源学院 ")
    expect(midtermDateIsAllowed("2026-09-19", rule)).toBe(false)
    expect(midtermDateIsAllowed("2026-09-20", rule)).toBe(true)
    expect(midtermDateIsAllowed("2026-09-30", rule)).toBe(true)
    expect(midtermDateIsAllowed("2026-10-01", rule)).toBe(false)
    expect(midtermDateIsAllowed("2026-10-01", midtermDateRuleForCollege(rules, "其他学院"))).toBe(true)
  })
})
