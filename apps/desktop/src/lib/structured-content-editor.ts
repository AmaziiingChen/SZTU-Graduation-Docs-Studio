import Subscript from "@tiptap/extension-subscript"
import Superscript from "@tiptap/extension-superscript"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Plugin } from "@tiptap/pm/state"
import {
  Extension,
  type Editor,
  type JSONContent,
} from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"

import type {
  ParagraphInput,
  StructuredBodyValue,
  StructuredListBlock,
  StructuredRun,
} from "@/types/structured-content"

export const MAX_STRUCTURED_LIST_DEPTH = 4
export type StructuredEditorMode = "body" | "paragraphs" | "inline"

const LIST_NODE_NAMES = new Set(["orderedList", "bulletList"])
const ALLOWED_MARK_NAMES = new Set([
  "bold",
  "italic",
  "subscript",
  "superscript",
])

function isStructuredRun(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  const run = value as Record<string, unknown>
  return (
    typeof run.text === "string" &&
    (run.script === undefined ||
      run.script === "normal" ||
      run.script === "sub" ||
      run.script === "super") &&
    (run.bold === undefined || typeof run.bold === "boolean") &&
    (run.italic === undefined || typeof run.italic === "boolean")
  )
}

export function isParagraphInput(value: unknown): value is ParagraphInput {
  if (typeof value === "string") return true
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  const paragraph = value as Record<string, unknown>
  return (
    (paragraph.type === undefined || paragraph.type === "paragraph") &&
    Array.isArray(paragraph.runs) &&
    paragraph.runs.every(isStructuredRun)
  )
}

function isStructuredListBlock(value: unknown, depth: number): boolean {
  if (
    depth > MAX_STRUCTURED_LIST_DEPTH ||
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false
  }
  const list = value as Record<string, unknown>
  if (
    (list.type !== "ordered_list" && list.type !== "unordered_list") ||
    !Array.isArray(list.items) ||
    list.items.length === 0
  ) {
    return false
  }
  return list.items.every((rawItem) => {
    if (typeof rawItem !== "object" || rawItem === null || Array.isArray(rawItem)) {
      return false
    }
    const item = rawItem as Record<string, unknown>
    if (!isParagraphInput(item.content)) return false
    if (list.type === "unordered_list" && item.marker !== undefined) return false
    if (item.marker !== undefined && typeof item.marker !== "string") return false
    return (
      item.children === undefined ||
      isStructuredListBlock(item.children, depth + 1)
    )
  })
}

/** Runtime guard for the text-only subset exposed by the workbench editor. */
export function isStructuredBodyValue(value: unknown): value is StructuredBodyValue {
  return (
    Array.isArray(value) &&
    value.every(
      (block) => isParagraphInput(block) || isStructuredListBlock(block, 1),
    )
  )
}

function marksForRun(
  run: StructuredRun,
): NonNullable<JSONContent["marks"]> | undefined {
  const marks: NonNullable<JSONContent["marks"]> = []
  if (run.bold) marks.push({ type: "bold" })
  if (run.italic) marks.push({ type: "italic" })
  if (run.script === "sub") marks.push({ type: "subscript" })
  if (run.script === "super") marks.push({ type: "superscript" })
  return marks.length ? marks : undefined
}

function paragraphToTiptap(paragraph: ParagraphInput): JSONContent {
  if (typeof paragraph === "string") {
    return {
      type: "paragraph",
      content: paragraph ? [{ type: "text", text: paragraph }] : undefined,
    }
  }

  const content = paragraph.runs.flatMap((run) => {
    if (!run.text) return []
    return [
      {
        type: "text",
        text: run.text,
        marks: marksForRun(run),
      },
    ]
  })

  return {
    type: "paragraph",
    content: content.length ? content : undefined,
  }
}

function markerStart(marker: string | undefined): number | undefined {
  const match = marker?.trim().match(/^(\d+)(?:[.)、])?$/)
  if (!match) return undefined
  const start = Number(match[1])
  return Number.isSafeInteger(start) && start > 0 ? start : undefined
}

function listToTiptap(
  list: StructuredListBlock,
  depth: number,
): JSONContent {
  if (depth > MAX_STRUCTURED_LIST_DEPTH) {
    throw new RangeError(`正文列表最多支持 ${MAX_STRUCTURED_LIST_DEPTH} 级。`)
  }

  const ordered = list.type === "ordered_list"
  const firstMarker = ordered ? list.items[0]?.marker : undefined
  const start = markerStart(firstMarker)

  return {
    type: ordered ? "orderedList" : "bulletList",
    attrs: ordered && start ? { start } : undefined,
    content: list.items.map((item) => {
      if (!ordered && "marker" in item && item.marker !== undefined) {
        throw new TypeError("无序列表项不能包含 marker。")
      }
      return {
        type: "listItem",
        attrs:
          ordered && item.marker !== undefined
            ? { contractMarker: item.marker }
            : undefined,
        content: [
          paragraphToTiptap(item.content),
          ...(item.children ? [listToTiptap(item.children, depth + 1)] : []),
        ],
      }
    }),
  }
}

/** Convert the repository-owned body contract into editor view state. */
export function structuredBodyToTiptap(value: StructuredBodyValue): JSONContent {
  return {
    type: "doc",
    content: value.length
      ? value.map((block) => {
          const isList =
            typeof block !== "string" &&
            (block.type === "ordered_list" || block.type === "unordered_list")
          if (isList) return listToTiptap(block, 1)
          if (isParagraphInput(block)) {
            return paragraphToTiptap(block as ParagraphInput)
          }
          throw new TypeError("正文编辑器仅支持段落及四级以内的有序或无序列表。")
        })
      : [{ type: "paragraph" }],
  }
}

function styleForTextNode(node: JSONContent): Omit<StructuredRun, "text"> {
  const markNames = new Set((node.marks ?? []).map((mark) => mark.type))
  for (const markName of markNames) {
    if (markName && !ALLOWED_MARK_NAMES.has(markName)) {
      throw new TypeError(`编辑器包含不受支持的格式：${markName}。`)
    }
  }
  if (markNames.has("subscript") && markNames.has("superscript")) {
    throw new TypeError("同一段文字不能同时使用上标和下标。")
  }
  return {
    bold: markNames.has("bold"),
    italic: markNames.has("italic"),
    script: markNames.has("subscript")
      ? "sub"
      : markNames.has("superscript")
        ? "super"
        : "normal",
  }
}

function sameRunStyle(
  left: Omit<StructuredRun, "text">,
  right: Omit<StructuredRun, "text">,
): boolean {
  return (
    left.bold === right.bold &&
    left.italic === right.italic &&
    left.script === right.script
  )
}

function paragraphFromTiptap(node: JSONContent): ParagraphInput {
  if (node.type !== "paragraph") {
    throw new TypeError("列表项必须以正文段落开始。")
  }

  const runs: StructuredRun[] = []
  for (const child of node.content ?? []) {
    if (child.type !== "text") {
      throw new TypeError(`正文段落包含不受支持的节点：${child.type ?? "未知"}。`)
    }
    const text = child.text ?? ""
    if (!text) continue
    const style = styleForTextNode(child)
    const previous = runs.at(-1)
    if (previous && sameRunStyle(previous, style)) {
      previous.text += text
    } else {
      runs.push({ text, ...style })
    }
  }

  const hasFormatting = runs.some(
    (run) => run.bold || run.italic || run.script !== "normal",
  )
  if (!hasFormatting) return runs.map((run) => run.text).join("")

  return {
    type: "paragraph",
    runs,
  }
}

function paragraphHasText(paragraph: ParagraphInput): boolean {
  if (typeof paragraph === "string") return paragraph.trim().length > 0
  return paragraph.runs.some((run) => run.text.trim().length > 0)
}

function listFromTiptap(node: JSONContent, depth: number): StructuredListBlock {
  if (depth > MAX_STRUCTURED_LIST_DEPTH) {
    throw new RangeError(`正文列表最多支持 ${MAX_STRUCTURED_LIST_DEPTH} 级。`)
  }
  const ordered = node.type === "orderedList"
  if (!ordered && node.type !== "bulletList") {
    throw new TypeError(`正文包含不受支持的列表节点：${node.type ?? "未知"}。`)
  }

  const items = (node.content ?? []).map((itemNode) => {
    if (itemNode.type !== "listItem") {
      throw new TypeError("列表只能包含列表项。")
    }
    const children = itemNode.content ?? []
    if (
      children.length < 1 ||
      children.length > 2 ||
      children[0]?.type !== "paragraph" ||
      (children[1] && !LIST_NODE_NAMES.has(children[1].type ?? ""))
    ) {
      throw new TypeError("每个列表项只能包含一个段落和一个可选子列表。")
    }

    const marker = itemNode.attrs?.contractMarker
    if (marker !== undefined && marker !== null && typeof marker !== "string") {
      throw new TypeError("列表 marker 必须是字符串。")
    }

    return {
      content: paragraphFromTiptap(children[0]),
      ...(ordered && typeof marker === "string" ? { marker } : {}),
      ...(children[1]
        ? { children: listFromTiptap(children[1], depth + 1) }
        : {}),
    }
  })

  if (ordered) return { type: "ordered_list", items }
  return {
    type: "unordered_list",
    items: items.map((item) => ({
      content: item.content,
      ...(item.children ? { children: item.children } : {}),
    })),
  }
}

/** Convert editor view state back to the repository-owned body contract. */
export function tiptapToStructuredBody(document: JSONContent): StructuredBodyValue {
  if (document.type !== "doc") {
    throw new TypeError("编辑器根节点必须是 doc。")
  }

  const blocks: StructuredBodyValue = []
  for (const node of document.content ?? []) {
    if (node.type === "paragraph") {
      const paragraph = paragraphFromTiptap(node)
      if (paragraphHasText(paragraph)) blocks.push(paragraph)
      continue
    }
    if (LIST_NODE_NAMES.has(node.type ?? "")) {
      blocks.push(listFromTiptap(node, 1))
      continue
    }
    throw new TypeError(`正文包含不受支持的节点：${node.type ?? "未知"}。`)
  }
  return blocks
}

export function structuredBodyFingerprint(value: StructuredBodyValue): string {
  return JSON.stringify(tiptapToStructuredBody(structuredBodyToTiptap(value)))
}

export function listDepthAtSelection(editor: Editor): number {
  const { $from } = editor.state.selection
  let depth = 0
  for (let positionDepth = 0; positionDepth <= $from.depth; positionDepth += 1) {
    if (LIST_NODE_NAMES.has($from.node(positionDepth).type.name)) depth += 1
  }
  return depth
}

function isRestrictedDocument(
  document: ProseMirrorNode,
  mode: StructuredEditorMode,
): boolean {
  let valid = true

  if (mode === "inline" && document.childCount > 1) return false

  const visit = (node: ProseMirrorNode, listDepth: number) => {
    if (!valid) return
    const isList = LIST_NODE_NAMES.has(node.type.name)
    if (isList && mode !== "body") {
      valid = false
      return
    }
    const nextListDepth = isList ? listDepth + 1 : listDepth
    if (nextListDepth > MAX_STRUCTURED_LIST_DEPTH) {
      valid = false
      return
    }

    if (node.type.name === "listItem") {
      if (
        node.childCount < 1 ||
        node.childCount > 2 ||
        node.child(0).type.name !== "paragraph" ||
        (node.childCount === 2 && !LIST_NODE_NAMES.has(node.child(1).type.name))
      ) {
        valid = false
        return
      }
    }

    if (node.isText) {
      const markNames = new Set(node.marks.map((mark) => mark.type.name))
      if (
        [...markNames].some((markName) => !ALLOWED_MARK_NAMES.has(markName)) ||
        (markNames.has("subscript") && markNames.has("superscript"))
      ) {
        valid = false
      }
      return
    }

    node.forEach((child) => visit(child, nextListDepth))
  }

  visit(document, 0)
  return valid
}

const ContractListMarker = Extension.create({
  name: "contractListMarker",
  addGlobalAttributes() {
    return [
      {
        types: ["listItem"],
        attributes: {
          contractMarker: {
            default: null,
            rendered: false,
            keepOnSplit: false,
          },
        },
      },
    ]
  },
})

function createRestrictedDocumentBehavior(mode: StructuredEditorMode) {
  return Extension.create({
    name: `restrictedDocumentBehavior-${mode}`,
    priority: 1_000,
    addKeyboardShortcuts() {
      return {
        ...(mode === "inline"
          ? {
              Enter: () => true,
              "Shift-Enter": () => true,
            }
          : {}),
        Tab: () => {
          if (mode !== "body" || !this.editor.isActive("listItem")) return false
          if (listDepthAtSelection(this.editor) >= MAX_STRUCTURED_LIST_DEPTH) {
            return true
          }
          return this.editor.commands.sinkListItem("listItem")
        },
        "Shift-Tab": () => {
          if (mode !== "body" || !this.editor.isActive("listItem")) return false
          return this.editor.commands.liftListItem("listItem")
        },
      }
    },
    addProseMirrorPlugins() {
      return [
        new Plugin({
          filterTransaction(transaction) {
            return (
              !transaction.docChanged ||
              isRestrictedDocument(transaction.doc, mode)
            )
          },
        }),
      ]
    },
  })
}

export function createRestrictedEditorExtensions(
  mode: StructuredEditorMode = "body",
) {
  const listsEnabled = mode === "body"
  return [
    StarterKit.configure({
      blockquote: false,
      code: false,
      codeBlock: false,
      dropcursor: false,
      gapcursor: false,
      hardBreak: false,
      heading: false,
      horizontalRule: false,
      link: false,
      bulletList: listsEnabled ? {} : false,
      listItem: listsEnabled ? {} : false,
      orderedList: listsEnabled ? {} : false,
      strike: false,
      trailingNode: false,
      underline: false,
    }),
    ...(listsEnabled ? [ContractListMarker] : []),
    Subscript,
    Superscript,
    createRestrictedDocumentBehavior(mode),
  ]
}
