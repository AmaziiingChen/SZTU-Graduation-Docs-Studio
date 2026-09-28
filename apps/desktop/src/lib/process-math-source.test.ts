import { describe, expect, it } from "vitest"
import { editableMathSource, hasUnescapedMathDelimiter, mathExpressionToSource, parseMathSource } from "@/lib/process-math-source"

describe("process-document math source", () => {
  it("parses inline syntax into the same structured expression used by Word and PDF", () => {
    const expression = parseMathSource("E=mc^2+\\frac{a}{b}+\\sqrt{x}+\\alpha")
    expect(expression.type).toBe("row")
    expect(JSON.stringify(expression)).toContain('"type":"superscript"')
    expect(JSON.stringify(expression)).toContain('"type":"fraction"')
    expect(JSON.stringify(expression)).toContain('"type":"square_root"')
    expect(JSON.stringify(expression)).toContain("α")
    expect(parseMathSource(mathExpressionToSource(expression))).toEqual(expression)
    expect(parseMathSource("x".repeat(150)).type).toBe("row")
  })
  it("keeps old structured equations editable without relying on their prose alt", () => {
    const expression = parseMathSource("\\frac{a}{b}")
    expect(editableMathSource(expression, "a 除以 b")).toBe("\\frac{a}{b}")
    expect(editableMathSource(expression, "\\frac{a}{b}")).toBe("\\frac{a}{b}")
  })
  it("leaves incomplete or unsupported commands visible for correction", () => {
    expect(() => parseMathSource("\\input{private}")).toThrow("暂不支持")
    expect(() => parseMathSource("\\frac{a}")).toThrow("{ }")
    expect(() => parseMathSource("x^")).toThrow("缺少")
    expect(hasUnescapedMathDelimiter("x^2 与 $x^2$")).toBe(true)
    expect(hasUnescapedMathDelimiter(String.raw`价格 \$10`)).toBe(false)
  })
})
