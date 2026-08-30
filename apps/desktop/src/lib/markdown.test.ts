import { describe, expect, it } from "vitest"

import {
  contentBlocksToMarkdown,
  markdownPlainText,
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
      items: [{ marker: "1、" }, { marker: "2、" }],
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
                { marker: "1、" },
                {
                  marker: "2、",
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
    expect(markdownToContentBlocks(contentBlocksToMarkdown(blocks))).toEqual(
      blocks,
    )
  })

  it("does not preserve raw HTML as executable markup", () => {
    expect(markdownPlainText("安全文本<script>alert(1)</script>")).toBe("安全文本alert(1)")
  })

  it("preserves unsupported legacy blocks as visible plain text", () => {
    expect(markdownPlainText("> 重要内容")).toBe("> 重要内容")
    expect(markdownPlainText("```text\n不能丢失\n```")).toBe(
      "```text\n不能丢失\n```",
    )
    expect(markdownPlainText("[链接文字](https://example.invalid)")).toBe(
      "[链接文字](https://example.invalid)",
    )
  })
})
