import { describe, expect, it } from "vitest"

import {
  chineseOutlineNumber,
  numberOutlineLevels,
  outlineStyleMaxDepth,
} from "./outline-numbering"

describe("outline numbering", () => {
  it("formats Chinese counters deterministically", () => {
    expect([1, 10, 11, 20, 101].map(chineseOutlineNumber)).toEqual([
      "一",
      "十",
      "十一",
      "二十",
      "一百零一",
    ])
  })

  it("supports the five official numbering formats", () => {
    expect(
      numberOutlineLevels([1, 2, 3, 4], "chinese_hierarchy"),
    ).toEqual(["一、", "（一）", "1.", "(1)"])
    expect(
      numberOutlineLevels([1, 2, 3, 4, 5], "chapter_hierarchy"),
    ).toEqual(["第一章", "一、", "（一）", "1.", "(1)"])
    expect(
      numberOutlineLevels(
        [1, 2, 3, 4, 5, 6],
        "chapter_section_hierarchy",
      ),
    ).toEqual(["第一章", "第一节", "一、", "（一）", "1.", "(1)"])
    expect(
      numberOutlineLevels(
        [1, 2, 3, 4, 5, 6],
        "part_chapter_section_hierarchy",
      ),
    ).toEqual(["第一篇", "第一章", "第一节", "一、", "（一）", "1."])
    expect(
      numberOutlineLevels([1, 2, 3, 2, 3], "decimal_hierarchy"),
    ).toEqual(["1.", "1.1", "1.1.1", "1.2", "1.2.1"])
  })

  it("resets descendants and enforces each style depth", () => {
    expect(
      numberOutlineLevels([1, 2, 1, 2], "chinese_hierarchy"),
    ).toEqual(["一、", "（一）", "二、", "（一）"])
    expect(outlineStyleMaxDepth("chinese_hierarchy")).toBe(4)
    expect(outlineStyleMaxDepth("chapter_section_hierarchy")).toBe(6)
    expect(() =>
      numberOutlineLevels([1, 2, 3, 4, 5], "chinese_hierarchy"),
    ).toThrow("1 至 4")
  })
})
