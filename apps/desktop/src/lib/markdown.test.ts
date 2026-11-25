import { describe, expect, it } from "vitest"

import {
  markdownToContentBlocks,
  markdownToInlineParagraph,
  markdownToParagraphs,
} from "./markdown"

describe("restricted Markdown document contract", () => {
  it("maps emphasis and math scripts to explicit rich runs", () => {
    expect(markdownToInlineParagraph("**CO**$_2$ 与 *R*$^2$"))
      .toEqual({
        type: "paragraph",
        runs: [
          { text: "CO", bold: true, italic: false, script: "normal" },
          { text: "2", bold: false, italic: false, script: "sub" },
          { text: " 与 ", bold: false, italic: false, script: "normal" },
          { text: "R", bold: false, italic: true, script: "normal" },
          { text: "2", bold: false, italic: false, script: "super" },
        ],
      })
  })

  it("keeps paragraphs and ordered lists semantic", () => {
    expect(markdownToParagraphs("第一段\n\n1. **建模**\n2. 验收")).toHaveLength(3)
    expect(markdownToContentBlocks("1. 建模\n2. 验收")[0]).toMatchObject({
      type: "ordered_list",
      items: [{ marker: "1." }, { marker: "2." }],
    })
  })

  it("keeps unordered and nested list structure semantic", () => {
    const blocks = markdownToContentBlocks(
      "- 一级\n    1. 二级一\n    2. 二级二\n        - 三级",
    )
    expect(blocks).toMatchObject([
      {
        type: "unordered_list",
        items: [
          {
            content: { type: "paragraph" },
            children: {
              type: "ordered_list",
              items: [
                { marker: "1." },
                {
                  marker: "2.",
                  children: {
                    type: "unordered_list",
                    items: [{ content: { type: "paragraph" } }],
                  },
                },
              ],
            },
          },
        ],
      },
    ])
  })
})
