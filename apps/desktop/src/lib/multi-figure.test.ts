import { describe, expect, it } from "vitest"

import { generateMultiFigureLatex, validateFigureFilenames } from "@/lib/multi-figure"

describe("multi-figure source generation", () => {
  it("generates a single figure without subcaption", () => {
    const latex = generateMultiFigureLatex({
      images: [{ filename: "实验 图.png" }],
      columns: 1,
      caption: "实验结果",
    })
    expect(latex).toContain("\\includegraphics[width=0.96\\textwidth]{\\detokenize{figures/实验 图.png}}")
    expect(latex).not.toContain("\\begin{subfigure}")
  })

  it("lays multiple images out in rows and escapes captions", () => {
    const latex = generateMultiFigureLatex({
      images: [
        { filename: "a.png", caption: "样品 A&B" },
        { filename: "b.png", caption: "样品 B" },
        { filename: "c.png", caption: "样品 C" },
      ],
      columns: 2,
      label: "fig:result",
    })
    expect(latex.match(/\\begin{subfigure}/g)).toHaveLength(3)
    expect(latex).toContain("\\caption{样品 A\\&B}")
    expect(latex).toContain("\\par\\medskip")
    expect(latex).toContain("\\label{fig:result}")
  })

  it("blocks duplicate or unsafe image names", () => {
    expect(validateFigureFilenames([
      { filename: "a.png" },
      { filename: "a.png" },
      { filename: "bad%name.png" },
    ])).toHaveLength(2)
    expect(generateMultiFigureLatex({
      images: [{ filename: "bad%name.png" }],
      columns: 1,
    })).toBe("")
  })
})
