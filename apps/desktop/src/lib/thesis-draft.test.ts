import { describe, expect, it } from "vitest"
import { normalizeThesisFigures, thesisFigureContext, chapterEnd, chapterNumbers, emptyThesisDraft, moveChapter, readThesisDraft } from "./thesis-draft"
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
  it("moves a whole chapter subtree and regenerates numbering without changing IDs or text", () => {
    const moved = moveChapter(chapters, 0, 1)
    expect(moved.map(c => c.id)).toEqual(["d", "e", "a", "b", "c"])
    expect(chapterNumbers(moved)).toEqual(["1", "1.1", "2", "2.1", "2.1.1"])
    expect(moveChapter(moved, 2, -1)).toEqual(chapters)
    expect(moveChapter(chapters, 1, 1)).toEqual(chapters)
    expect(chapterEnd(chapters, 0)).toBe(3)
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

it("renumbers figures across sections and moved chapters while preserving references", () => {
  const image = (id: string) => ({ type: "image" as const, id, chapter: 1, path: "assets/fixture.png", alt: "合成图", caption: "合成图" })
  const draft = normalizeThesisFigures({ ...emptyThesisDraft(), chapters: [
    { ...chapters[0], body: [image("fig-aaaaaaaa")] },
    { ...chapters[1], body: [image("fig-bbbbbbbb"), "见{{fig:fig-aaaaaaaa}}"] },
    { ...chapters[3], body: [image("fig-cccccccc")] },
  ] })
  expect(thesisFigureContext(draft, 1).numbering.startCounts).toEqual({ 1: 1 })
  expect(thesisFigureContext(draft, 1).catalog.map(f => f.label)).toEqual(["图 1-1", "图 1-2", "图 2-1"])
  const moved = normalizeThesisFigures({ ...draft, chapters: moveChapter(draft.chapters, 0, 1) })
  expect(thesisFigureContext(moved, 2).catalog.map(f => [f.id, f.label])).toEqual([["fig-cccccccc", "图 1-1"], ["fig-aaaaaaaa", "图 2-1"], ["fig-bbbbbbbb", "图 2-2"]])
  expect(readThesisDraft(JSON.parse(JSON.stringify(moved)))).toEqual(moved)
  expect(moved.chapters[2].body[1]).toBe("见{{fig:fig-aaaaaaaa}}")
})

it("numbers citations by first use, tracks equations and reports removed targets", async () => {
  const { thesisReferences } = await import("./thesis-draft")
  const draft = { ...emptyThesisDraft(), referencesBibtex: "@book{a,title={A},year={2026}}\n@book{b,title={B},year={2026}}", chapters: [{ id: "a", level: 1, title: "示例", body: ["先见{{cite:b}}，再见{{cite:a}}。重复{{cite:b}}。参见{{eq:eq-aaaaaaaa}}", { type: "equation" as const, id: "eq-aaaaaaaa", latex: "E=mc^{2}" }] }] }
  expect(thesisReferences(draft).labels).toEqual({ "cite:b": "[1]", "cite:a": "[2]", "eq:eq-aaaaaaaa": "式（1-1）" })
  expect(readThesisDraft(JSON.parse(JSON.stringify(draft)))).toEqual(draft)
  draft.chapters[0].body.pop()
  draft.referencesBibtex = "@book{a,title={A},year={2026}}"
  expect(thesisReferences(draft).missing).toEqual(["文献：b", "公式：eq-aaaaaaaa"])
})
