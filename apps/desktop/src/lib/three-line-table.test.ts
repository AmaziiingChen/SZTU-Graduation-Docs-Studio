import { describe, expect, it } from "vitest"

import {
  escapeLatex,
  generateThreeLineTableLatex,
  parseTableText,
} from "@/lib/three-line-table"

describe("three-line table helpers", () => {
  it("parses tab-separated spreadsheet data", () => {
    expect(parseTableText("名称\t数值\n样品 A\t12")).toEqual({
      rows: [["名称", "数值"], ["样品 A", "12"]],
      errors: [],
    })
  })

  it("parses quoted CSV cells", () => {
    expect(parseTableText('名称,说明\n样品 A,"包含,逗号"').rows).toEqual([
      ["名称", "说明"],
      ["样品 A", "包含,逗号"],
    ])
  })

  it("reports uneven rows", () => {
    expect(parseTableText("名称\t数值\n样品 A").errors).toContain("第 2 行有 1 列，应为 2 列。")
  })

  it("escapes LaTeX special characters", () => {
    expect(escapeLatex("A&B_1%")).toBe("A\\&B\\_1\\%")
  })

  it("generates a booktabs table from the parsed rows", () => {
    const latex = generateThreeLineTableLatex({
      rows: [["名称", "数值"], ["样品_A", "12%"]],
      caption: "测试结果",
      label: "tab:result",
    })
    expect(latex).toContain("\\begin{tabular}{lc}")
    expect(latex).toContain("\\toprule")
    expect(latex).toContain("名称 & 数值 \\\\")
    expect(latex).toContain("样品\\_A & 12\\% \\\\")
    expect(latex).toContain("\\caption{测试结果}")
  })
})
