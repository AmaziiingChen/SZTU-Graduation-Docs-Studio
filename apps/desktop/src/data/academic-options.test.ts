import { describe, expect, it } from "vitest"

import {
  ACADEMIC_OPTIONS,
  normalizeAcademicClassLabel,
} from "./academic-options"

const compareText = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0

const expectUniqueAndSorted = (values: string[]) => {
  expect(new Set(values).size).toBe(values.length)
  expect(values).toEqual([...values].sort(compareText))
}

describe("academic options", () => {
  it("contains only non-empty unique paths", () => {
    const colleges = ACADEMIC_OPTIONS.map((option) => option.college)
    expect(new Set(colleges).size).toBe(colleges.length)

    for (const college of ACADEMIC_OPTIONS) {
      expect(college.college.trim()).toBe(college.college)
      expect(college.college).not.toBe("")

      const majors = college.majors.map((option) => option.major)
      expectUniqueAndSorted(majors)

      for (const major of college.majors) {
        expect(major.major.trim()).toBe(major.major)
        expect(major.major).not.toBe("")
        expectUniqueAndSorted(major.classes)
        expect(major.classes.length).toBeGreaterThan(0)
        for (const className of major.classes) {
          expect(className.trim()).toBe(className)
          expect(className).not.toBe("")
          expect(className).not.toMatch(/^(?:\d{2}|\d{4})\s*级/u)
        }
      }
    }
  })

  it("follows the university college selector order without adding entries", () => {
    expect(ACADEMIC_OPTIONS.map((option) => option.college)).toEqual([
      "中德智能制造学院",
      "人工智能学院",
      "新材料与新能源学院",
      "城市交通与物流学院",
      "健康与环境工程学院",
      "创意设计学院",
      "商学院",
      "工程物理学院",
      "药学院",
      "外国语学院",
      "未来技术学院",
      "集成电路与光电芯片学院",
      "音乐学院",
      "大数据与互联网学院",
    ])
  })

  it("removes two-digit and four-digit grade prefixes", () => {
    expect(normalizeAcademicClassLabel("23级新能源1班")).toBe("新能源1班")
    expect(normalizeAcademicClassLabel("2024级新能源2班")).toBe("新能源2班")
    expect(normalizeAcademicClassLabel(" 23级新能源3班 ")).toBe("新能源3班")
    expect(normalizeAcademicClassLabel("新能源3班")).toBe("新能源3班")
    expect(normalizeAcademicClassLabel("实验23级1班")).toBe("实验23级1班")
  })

  it("merges repeated class labels within the same college and major", () => {
    const college = ACADEMIC_OPTIONS.find(
      (option) => option.college === "新材料与新能源学院",
    )
    const major = college?.majors.find(
      (option) => option.major === "新能源科学与工程",
    )

    expect(major?.classes).toEqual(["新能源1班", "新能源2班", "新能源3班"])
  })

  it("keeps identical labels in their own college and major scopes", () => {
    const futureTechnology = ACADEMIC_OPTIONS.find(
      (option) => option.college === "未来技术学院",
    )
    const newEnergy = futureTechnology?.majors.find(
      (option) => option.major === "新能源科学与工程",
    )
    const electronicScience = futureTechnology?.majors.find(
      (option) => option.major === "电子科学与技术",
    )

    expect(newEnergy?.classes).toContain("新才2班")
    expect(electronicScience?.classes).toContain("新才2班")
  })

  it("keeps the reviewed aggregate coverage", () => {
    const majorCount = ACADEMIC_OPTIONS.reduce(
      (count, college) => count + college.majors.length,
      0,
    )
    const classCount = ACADEMIC_OPTIONS.reduce(
      (count, college) =>
        count +
        college.majors.reduce(
          (majorCount, major) => majorCount + major.classes.length,
          0,
        ),
      0,
    )

    expect(ACADEMIC_OPTIONS).toHaveLength(14)
    expect(majorCount).toBe(49)
    expect(classCount).toBe(126)
  })
})
