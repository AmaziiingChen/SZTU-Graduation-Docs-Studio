import { describe, expect, it } from "vitest"
import { emptyThesisDraft, readThesisDraft } from "./thesis-draft"
const chapters = [
  { id: "a", level: 1, title: "绪论", body: ["甲"] },
  { id: "b", level: 2, title: "背景", body: ["乙"] },
  { id: "c", level: 3, title: "范围", body: ["丙"] },
  { id: "d", level: 1, title: "实验", body: ["丁"] },
  { id: "e", level: 2, title: "方法", body: ["戊"] },
]
describe("thesis draft contract", () => {
  it("opens a pre-export thesis draft with an empty submission date for the author to fill", () => {
    const { submissionDate: _omitted, ...oldDraft } = emptyThesisDraft()
    expect(readThesisDraft(oldDraft).submissionDate).toBe("")
    expect(() => readThesisDraft({ ...oldDraft, submissionDate: "not-a-date" })).toThrow()
  })
  it("retains rich text and all fields across a serialization round trip", () => {
    const draft = { ...emptyThesisDraft(), chapters, abstractCn: [{ runs: [{ text: "合成摘要", bold: true }] }], referencesBibtex: "@book{synthetic,title={示例}}" }
    expect(readThesisDraft(JSON.parse(JSON.stringify(draft)))).toEqual(draft)
  })
  it("rejects duplicate IDs, skipped levels, unsupported versions and malformed text instead of dropping them", () => {
    for (const value of [
      { ...emptyThesisDraft(), chapters: [chapters[0], chapters[0]] },
      { ...emptyThesisDraft(), chapters: [chapters[1]] },
      { ...emptyThesisDraft(), version: 2 },
      { ...emptyThesisDraft(), abstractEn: [{ type: "unknown", text: "must survive" }] },
    ]) expect(() => readThesisDraft(value)).toThrow()
  })
})
