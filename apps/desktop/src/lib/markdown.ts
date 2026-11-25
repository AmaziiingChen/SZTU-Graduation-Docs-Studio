import { unified } from "unified"
import remarkMath from "remark-math"
import remarkParse from "remark-parse"

import type { JsonObject } from "@/types/desktop-api"

type Script = "normal" | "sub" | "super"

type MarkdownNode = {
  type: string
  value?: string
  ordered?: boolean | null
  start?: number | null
  children?: MarkdownNode[]
}

type RunStyle = {
  bold: boolean
  italic: boolean
  script: Script
}

type RichRun = RunStyle & { text: string }

const processor = unified().use(remarkParse).use(remarkMath)
const normalStyle: RunStyle = { bold: false, italic: false, script: "normal" }
const supportedStructuredMarkdownNodes = new Set([
  "root",
  "paragraph",
  "list",
  "listItem",
  "text",
  "strong",
  "emphasis",
  "inlineMath",
  "math",
  "break",
  "html",
])

function usesOnlyStructuredMarkdown(node: MarkdownNode): boolean {
  return (
    supportedStructuredMarkdownNodes.has(node.type) &&
    (node.children ?? []).every(usesOnlyStructuredMarkdown)
  )
}

function appendRun(target: RichRun[], text: string, style: RunStyle): void {
  if (!text) return
  const previous = target.at(-1)
  if (
    previous &&
    previous.bold === style.bold &&
    previous.italic === style.italic &&
    previous.script === style.script
  ) {
    previous.text += text
    return
  }
  target.push({ text, ...style })
}

function mathRuns(value: string, style: RunStyle): RichRun[] {
  const runs: RichRun[] = []
  let normal = ""
  const flushNormal = () => {
    appendRun(runs, normal, style)
    normal = ""
  }

  for (let index = 0; index < value.length; index += 1) {
    const marker = value[index]
    if (marker !== "_" && marker !== "^") {
      normal += marker
      continue
    }

    const next = value[index + 1]
    if (!next) {
      normal += marker
      continue
    }

    let content = next
    if (next === "{") {
      const end = value.indexOf("}", index + 2)
      if (end === -1) {
        normal += marker
        continue
      }
      content = value.slice(index + 2, end)
      index = end
    } else {
      index += 1
    }
    flushNormal()
    appendRun(runs, content, {
      ...style,
      script: marker === "_" ? "sub" : "super",
    })
  }
  flushNormal()
  return runs
}

function inlineRuns(
  nodes: MarkdownNode[],
  style: RunStyle = normalStyle,
): RichRun[] {
  const runs: RichRun[] = []
  for (const node of nodes) {
    if (node.type === "text" || node.type === "inlineCode") {
      appendRun(runs, node.value ?? "", style)
      continue
    }
    if (node.type === "inlineMath") {
      for (const run of mathRuns(node.value ?? "", style)) appendRun(runs, run.text, run)
      continue
    }
    if (node.type === "break") {
      appendRun(runs, "\n", style)
      continue
    }
    if (node.type === "html") {
      appendRun(runs, (node.value ?? "").replace(/<[^>]*>/g, ""), style)
      continue
    }
    if (node.children) {
      const nestedStyle = {
        ...style,
        bold: style.bold || node.type === "strong",
        italic: style.italic || node.type === "emphasis",
      }
      for (const run of inlineRuns(node.children, nestedStyle)) {
        appendRun(runs, run.text, run)
      }
      continue
    }
    if (node.value) appendRun(runs, node.value, style)
  }
  return runs
}

function paragraphFromNodes(nodes: MarkdownNode[]): JsonObject {
  const runs = inlineRuns(nodes)
  return {
    type: "paragraph",
    runs: runs.length ? runs : [{ text: " ", ...normalStyle }],
  }
}

function listItemContent(item: MarkdownNode): JsonObject {
  const paragraph = item.children?.find((child) => child.type === "paragraph")
  return paragraphFromNodes(paragraph?.children ?? item.children ?? [])
}

function listBlock(node: MarkdownNode, depth = 1): JsonObject {
  const ordered = node.ordered === true
  const start = node.start ?? 1
  return {
    type: ordered ? "ordered_list" : "unordered_list",
    items: (node.children ?? []).map((item, index) => {
      const nestedList =
        depth < 4
          ? item.children?.find((child) => child.type === "list")
          : undefined
      return {
        ...(ordered ? { marker: `${start + index}.` } : {}),
        content: listItemContent(item),
        ...(nestedList ? { children: listBlock(nestedList, depth + 1) } : {}),
      }
    }),
  }
}

export function markdownToContentBlocks(value: string): JsonObject[] {
  const root = processor.parse(value) as MarkdownNode
  if (!usesOnlyStructuredMarkdown(root)) {
    return value
      ? [paragraphFromNodes([{ type: "text", value }])]
      : []
  }
  const blocks: JsonObject[] = []
  for (const node of root.children ?? []) {
    if (node.type === "list") {
      blocks.push(listBlock(node))
      continue
    }
    if (node.type === "paragraph" || node.type === "heading") {
      blocks.push(paragraphFromNodes(node.children ?? []))
      continue
    }
    if (node.type === "math") {
      blocks.push(paragraphFromNodes([{ type: "inlineMath", value: node.value ?? "" }]))
      continue
    }
    if (node.type === "html") {
      blocks.push(paragraphFromNodes([node]))
    }
  }
  return blocks
}

export function markdownToParagraphs(value: string): JsonObject[] {
  const flattenBlock = (block: JsonObject, depth = 0): JsonObject[] => {
    if (
      (block.type !== "ordered_list" && block.type !== "unordered_list") ||
      !Array.isArray(block.items)
    ) {
      return [block]
    }
    return block.items.flatMap((item, index) => {
      const record = item as JsonObject
      const content = record.content
      const marker =
        typeof record.marker === "string"
          ? record.marker
          : block.type === "unordered_list"
            ? "• "
            : `${index + 1}.`
      const prefix = `${"　".repeat(depth)}${marker}`
      let paragraph: JsonObject
      if (
        typeof content === "object" &&
        content !== null &&
        !Array.isArray(content) &&
        Array.isArray(content.runs)
      ) {
        paragraph = {
          type: "paragraph",
          runs: [{ text: prefix, ...normalStyle }, ...content.runs],
        }
      } else {
        paragraph = {
          type: "paragraph",
          runs: [{ text: prefix, ...normalStyle }],
        }
      }
      const children = objectRecord(record.children)
      return children.type === "ordered_list" || children.type === "unordered_list"
        ? [paragraph, ...flattenBlock(children as JsonObject, depth + 1)]
        : [paragraph]
    })
  }
  return markdownToContentBlocks(value).flatMap((block) => flattenBlock(block))
}

export function markdownToInlineParagraph(value: string): JsonObject {
  const paragraphs = markdownToParagraphs(value)
  if (paragraphs.length === 1) return paragraphs[0]
  const runs: JsonObject[] = []
  for (const [index, paragraph] of paragraphs.entries()) {
    if (index > 0) runs.push({ text: " ", ...normalStyle })
    if (Array.isArray(paragraph.runs)) runs.push(...(paragraph.runs as JsonObject[]))
  }
  return { type: "paragraph", runs: runs.length ? runs : [{ text: " ", ...normalStyle }] }
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function objectRecord(value: unknown): JsonObject {
  return objectValue(value) as JsonObject
}
