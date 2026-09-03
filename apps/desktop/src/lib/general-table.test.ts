import { describe, expect, it } from "vitest"

import {
  generateGeneralTableLatex,
  requiredPackagesForGeneralTable,
} from "@/lib/general-table"

describe("general table source generation", () => {
  const rows = [["项目", "结果"], ["A&B", "12%"]]

  it("generates a bordered table with escaped cells", () => {
    const latex = generateGeneralTableLatex({ rows })
    expect(latex).toContain("\\begin{tabular}{|l|c|}")
    expect(latex).toContain("\\textbf{项目} & \\textbf{结果}")
    expect(latex).toContain("A\\&B & 12\\%")
  })

  it("supports page-width columns with per-column alignment", () => {
    const latex = generateGeneralTableLatex({
      rows,
      mode: "page_width",
      alignments: ["right", "left"],
    })
    expect(latex).toContain("\\begin{tabularx}{\\textwidth}")
    expect(latex).toContain(">{\\raggedleft\\arraybackslash}X")
    expect(requiredPackagesForGeneralTable("page_width")).toEqual(["array", "tabularx"])
  })

  it("repeats headers for a long table", () => {
    const latex = generateGeneralTableLatex({ rows, mode: "long_table" })
    expect(latex).toContain("\\begin{longtable}{|l|c|}")
    expect(latex).toContain("\\endfirsthead")
    expect(latex).toContain("\\endhead")
  })
})
