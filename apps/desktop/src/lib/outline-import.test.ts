import { describe, expect, it } from "vitest"
import { parseOutlineText } from "./outline-import"
describe("outline text import", () => {
  it("recognizes levels and removes Word leaders and fixed entries", () => {
    const result = parseOutlineText("目录\n摘要\tI\nAbstract\tII\n1. 绪论....1\n1.1研究背景\t2\n1.2 研究现状\n1.2.1 国内现状……3\n2 方法\n参考文献\t9\n致谢\t10")
    expect(result.errors).toEqual([])
    expect(result.items.map(x => x.level)).toEqual([1,2,2,3,1])
    expect(result.items.map(x => x.title)).toEqual(["绪论","研究背景","研究现状","国内现状","方法"])
    expect(result.skipped).toBe(5)
  })
  it("preserves ambiguous trailing numbers and supports fullwidth numbering", () => {
    expect(parseOutlineText("１．绪论\n１．１ 数据 2026").items).toEqual([{ level: 1, title: "绪论" }, { level: 2, title: "数据 2026" }])
  })
  it.each(["1.1 孤立小节", "1 绪论\n1.2.1 跳级", "1.1", "未编号标题"])("blocks incomplete structure: %s", text => {
    expect(parseOutlineText(text).errors.length).toBeGreaterThan(0)
  })
})
