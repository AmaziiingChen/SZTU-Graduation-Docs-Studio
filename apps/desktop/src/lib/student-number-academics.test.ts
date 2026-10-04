import { describe, expect, it } from "vitest"
import { ACADEMIC_OPTIONS } from "@/data/academic-options"
import { inferStudentNumberAcademics, STUDENT_NUMBER_ACADEMIC_RULES } from "./student-number-academics"

describe("student-number academic defaults", () => {
  it.each([
    ["202300202999", "2027届", "人工智能学院", "计算机科学与技术"],
    ["202200101999", "2026届", "中德智能制造学院", "机械设计制造及其自动化"],
    ["202501203999", "2029届", "集成电路与光电芯片学院", "集成电路设计与集成系统（龙芯英才班）"],
    ["202301100999", "2027届", "药学院", "中药学（特）"],
    ["202301510999", "2027届", "创意设计学院", "计算机科学与技术专业（数字服饰技术精英班）"],
  ])("decodes %s using the admission year, four-digit college and major digit", (id, graduationCohort, college, major) => {
    expect(inferStudentNumberAcademics(id)).toEqual({ graduationCohort, college, major })
  })

  it("ignores the serial suffix and surrounding whitespace", () => {
    expect(inferStudentNumberAcademics(" 202300202998 ")).toEqual(inferStudentNumberAcademics("202300202999"))
  })

  it("uses the existing dropdown vocabulary for every supported mapping", () => {
    for (const [code, rule] of Object.entries(STUDENT_NUMBER_ACADEMIC_RULES)) {
      const college = ACADEMIC_OPTIONS.find(option => option.college === rule.college)
      expect(college, code).toBeDefined()
      for (const [majorCode, major] of Object.entries(rule.majors)) {
        expect(college?.majors.some(option => option.major === major), `${code}/${majorCode}: ${major}`).toBe(true)
      }
    }
  })

  it.each(["", "2023", "20230020299", "2023002029999", "20230020299X", "2023 00202999", "SYN-0001"])("does not infer from incomplete or invalid input %s", value => {
    expect(inferStudentNumberAcademics(value)).toBeNull()
  })

  it.each([
    ["202301002999", "外国语学院"],
    ["202300605999", "创意设计学院"],
    ["202300402999", "城市交通与物流学院"],
  ])("does not turn isolated transfer observations into a major mapping for %s", (id, college) => {
    expect(inferStudentNumberAcademics(id)).toEqual({ graduationCohort: "2027届", college })
  })

  it("only infers the year when the college code is unknown", () => {
    expect(inferStudentNumberAcademics("202399999999")).toEqual({ graduationCohort: "2027届" })
  })

  it.each([
    ["202101201999", "2025届"],
    ["202002029999", "2024届"],
    ["201901019999", "2023届"],
    ["20183219999", "2022届"],
  ])("does not apply modern college codes to older student number %s", (id, graduationCohort) => {
    expect(inferStudentNumberAcademics(id)).toEqual({ graduationCohort })
  })
})
