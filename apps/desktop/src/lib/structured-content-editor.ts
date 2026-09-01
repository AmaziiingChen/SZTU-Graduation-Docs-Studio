import Subscript from "@tiptap/extension-subscript"
import Superscript from "@tiptap/extension-superscript"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Plugin } from "@tiptap/pm/state"
import {
  Extension,
  Node,
  type Editor,
  type JSONContent,
} from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"

import type {
  ParagraphInput,
  StructuredBodyValue,
  StructuredImageBlock,
  StructuredListBlock,
  StructuredRun,
} from "@/types/structured-content"

export const MAX_STRUCTURED_LIST_DEPTH = 4
export type StructuredEditorMode = "body" | "paragraphs" | "inline"

export function editorShortcutLabels(platform: string) {
  const mac = /Mac|iPhone|iPad|iPod/i.test(platform)
  const modifier = mac ? "⌘" : "Ctrl"
  const shift = mac ? "⇧" : "Shift"
  return {
    bold: [modifier, "B"],
    italic: [modifier, "I"],
    subscript: [modifier, shift, "−"],
    superscript: [modifier, shift, "+"],
    outdent: [shift, "Tab"],
    indent: ["Tab"],
    undo: [modifier, "Z"],
    redo: [modifier, "Y"],
  } as const
}

const LIST_NODE_NAMES = new Set(["orderedList", "bulletList"])
const FIGURE_REFERENCE_PATTERN = /\{\{fig:(fig-[A-Za-z0-9_-]{8,96})\}\}/g
const ALLOWED_MARK_NAMES = new Set([
  "bold",
  "italic",
  "subscript",
  "superscript",
])

const UNICODE_SCRIPT_CHARACTERS: Readonly<
  Record<string, { text: string; script: "sub" | "super" }>
> = {
  "⁰": { text: "0", script: "super" },
  "¹": { text: "1", script: "super" },
  "²": { text: "2", script: "super" },
  "³": { text: "3", script: "super" },
  "⁴": { text: "4", script: "super" },
  "⁵": { text: "5", script: "super" },
  "⁶": { text: "6", script: "super" },
  "⁷": { text: "7", script: "super" },
  "⁸": { text: "8", script: "super" },
  "⁹": { text: "9", script: "super" },
  "⁺": { text: "+", script: "super" },
  "⁻": { text: "−", script: "super" },
  "⁼": { text: "=", script: "super" },
  "⁽": { text: "(", script: "super" },
  "⁾": { text: ")", script: "super" },
  "ⁱ": { text: "i", script: "super" },
  "ⁿ": { text: "n", script: "super" },
  "₀": { text: "0", script: "sub" },
  "₁": { text: "1", script: "sub" },
  "₂": { text: "2", script: "sub" },
  "₃": { text: "3", script: "sub" },
  "₄": { text: "4", script: "sub" },
  "₅": { text: "5", script: "sub" },
  "₆": { text: "6", script: "sub" },
  "₇": { text: "7", script: "sub" },
  "₈": { text: "8", script: "sub" },
  "₉": { text: "9", script: "sub" },
  "₊": { text: "+", script: "sub" },
  "₋": { text: "−", script: "sub" },
  "₌": { text: "=", script: "sub" },
  "₍": { text: "(", script: "sub" },
  "₎": { text: ")", script: "sub" },
  "ₐ": { text: "a", script: "sub" },
  "ₑ": { text: "e", script: "sub" },
  "ₒ": { text: "o", script: "sub" },
  "ₓ": { text: "x", script: "sub" },
  "ₕ": { text: "h", script: "sub" },
  "ₖ": { text: "k", script: "sub" },
  "ₗ": { text: "l", script: "sub" },
  "ₘ": { text: "m", script: "sub" },
  "ₙ": { text: "n", script: "sub" },
  "ₚ": { text: "p", script: "sub" },
  "ₛ": { text: "s", script: "sub" },
  "ₜ": { text: "t", script: "sub" },
}

const PLAIN_SCIENTIFIC_CHARACTER_REPLACEMENTS: Readonly<Record<string, string>> = {
  "℃": "°C",
}

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

function isStructuredImageBlock(value: unknown): value is StructuredImageBlock {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  const image = value as Record<string, unknown>
  return (
    image.type === "image" &&
    typeof image.path === "string" &&
    image.path.trim().length > 0 &&
    typeof image.alt === "string" &&
    image.alt.trim().length > 0 &&
    (image.id === undefined ||
      (typeof image.id === "string" &&
        /^fig-[A-Za-z0-9_-]{8,96}$/.test(image.id))) &&
    (image.chapter === undefined ||
      (Number.isInteger(image.chapter) && Number(image.chapter) >= 1 && Number(image.chapter) <= 99)) &&
    (image.width_mm === undefined ||
      (typeof image.width_mm === "number" && image.width_mm >= 20 && image.width_mm <= 146)) &&
    (image.caption === undefined || isParagraphInput(image.caption)) &&
    (image.source_citation_key === undefined ||
      (typeof image.source_citation_key === "string" &&
        image.source_citation_key.length <= 200 &&
        /^[A-Za-z0-9_:.+/-]+$/.test(image.source_citation_key)))
  )
}

/** Runtime guard for the text-only subset exposed by the workbench editor. */
export function isStructuredBodyValue(value: unknown): value is StructuredBodyValue {
  return (
    Array.isArray(value) &&
    value.every(
      (block) =>
        isParagraphInput(block) ||
        isStructuredListBlock(block, 1) ||
        isStructuredImageBlock(block),
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

function expandLegacyScientificText(
  text: string,
  style: Omit<StructuredRun, "text">,
): StructuredRun[] {
  const runs: StructuredRun[] = []
  const baseStyle: Omit<StructuredRun, "text"> = {
    bold: style.bold,
    italic: style.italic,
    script: style.script,
  }
  for (const character of text) {
    const mapped = UNICODE_SCRIPT_CHARACTERS[character]
    const nextStyle = {
      ...baseStyle,
      script:
        mapped && baseStyle.script === "normal"
          ? mapped.script
          : baseStyle.script,
    }
    const nextText = mapped?.text ??
      PLAIN_SCIENTIFIC_CHARACTER_REPLACEMENTS[character] ??
      character
    const previous = runs.at(-1)
    if (previous && sameRunStyle(previous, nextStyle)) {
      previous.text += nextText
    } else {
      runs.push({ text: nextText, ...nextStyle })
    }
  }
  return runs
}

function figureReferenceNodes(text: string, marks?: NonNullable<JSONContent["marks"]>): JSONContent[] {
  const nodes: JSONContent[] = []
  let cursor = 0
  for (const match of text.matchAll(FIGURE_REFERENCE_PATTERN)) {
    const index = match.index ?? 0
    if (index > cursor) {
      nodes.push({ type: "text", text: text.slice(cursor, index), ...(marks ? { marks } : {}) })
    }
    nodes.push({
      type: "figureReference",
      attrs: { figureId: match[1], label: "图（待编号）" },
    })
    cursor = index + match[0].length
  }
  if (cursor < text.length) {
    nodes.push({ type: "text", text: text.slice(cursor), ...(marks ? { marks } : {}) })
  }
  return nodes
}

function paragraphPlainText(paragraph: ParagraphInput | undefined): string {
  if (paragraph === undefined) return ""
  if (typeof paragraph === "string") return paragraph
  return paragraph.runs.map((run) => run.text).join("")
}

export type StructuredFigureCatalogItem = {
  id: string
  label: string
  caption: string
  chapter: number
}

export type FigureNumberingContext = {
  startCounts?: Readonly<Record<number, number>>
  knownLabels?: Readonly<Record<string, string>>
}

export function structuredFigureCatalog(
  ...bodyGroups: StructuredBodyValue[]
): StructuredFigureCatalogItem[] {
  const counters = new Map<number, number>()
  const catalog: StructuredFigureCatalogItem[] = []
  for (const body of bodyGroups) {
    for (const block of body) {
      if (!isStructuredImageBlock(block)) continue
      const chapter = block.chapter ?? 1
      const sequence = (counters.get(chapter) ?? 0) + 1
      counters.set(chapter, sequence)
      if (!block.id) continue
      catalog.push({
        id: block.id,
        label: `图 ${chapter}-${sequence}`,
        caption: paragraphPlainText(block.caption),
        chapter,
      })
    }
  }
  return catalog
}

export function structuredFigureChapterCounts(
  ...bodyGroups: StructuredBodyValue[]
): Record<number, number> {
  const counts: Record<number, number> = {}
  for (const body of bodyGroups) {
    for (const block of body) {
      if (!isStructuredImageBlock(block)) continue
      const chapter = block.chapter ?? 1
      counts[chapter] = (counts[chapter] ?? 0) + 1
    }
  }
  return counts
}

function managedFigurePreviewUrl(imagePath: string): string {
  const fileName = imagePath.split(/[\\/]/).at(-1) ?? ""
  return /^([a-f0-9]{64})\.(png|jpe?g)$/i.test(fileName)
    ? `sztu-asset://asset/${encodeURIComponent(fileName)}`
    : ""
}

function imageToTiptap(image: StructuredImageBlock): JSONContent {
  return {
    type: "figureBlock",
    attrs: {
      figureId: image.id ?? "",
      path: image.path,
      previewUrl: managedFigurePreviewUrl(image.path),
      alt: image.alt,
      chapter: image.chapter ?? 1,
      widthMm: image.width_mm ?? 120,
      caption: image.caption ?? "",
      captionText: paragraphPlainText(image.caption),
      sourceCitationKey: image.source_citation_key ?? "",
      label: "图（待编号）",
    },
  }
}

function paragraphToTiptap(paragraph: ParagraphInput): JSONContent {
  const sourceRuns: StructuredRun[] =
    typeof paragraph === "string"
      ? [{ text: paragraph, bold: false, italic: false, script: "normal" }]
      : paragraph.runs
  const content = sourceRuns.flatMap((run) =>
    expandLegacyScientificText(run.text, run).flatMap((expanded) => {
      if (!expanded.text) return []
      const marks = marksForRun(expanded)
      return figureReferenceNodes(expanded.text, marks)
    }),
  )

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
export function structuredBodyToTiptap(
  value: StructuredBodyValue,
  numbering: FigureNumberingContext = {},
): JSONContent {
  const document: JSONContent = {
    type: "doc",
    content: value.length
      ? value.map((block) => {
          const isList =
            typeof block !== "string" &&
            (block.type === "ordered_list" || block.type === "unordered_list")
          if (isList) return listToTiptap(block, 1)
          if (isStructuredImageBlock(block)) return imageToTiptap(block)
          if (isParagraphInput(block)) {
            return paragraphToTiptap(block as ParagraphInput)
          }
          throw new TypeError("正文编辑器仅支持段落及四级以内的有序或无序列表。")
        })
      : [{ type: "paragraph" }],
  }
  const counters = new Map<number, number>(
    Object.entries(numbering.startCounts ?? {}).map(([chapter, count]) => [Number(chapter), count]),
  )
  const labels = new Map<string, string>(Object.entries(numbering.knownLabels ?? {}))
  const visit = (node: JSONContent, callback: (item: JSONContent) => void) => {
    callback(node)
    for (const child of node.content ?? []) visit(child, callback)
  }
  visit(document, (node) => {
    if (node.type !== "figureBlock") return
    const chapter = Number(node.attrs?.chapter ?? 1)
    const sequence = (counters.get(chapter) ?? 0) + 1
    counters.set(chapter, sequence)
    const label = `图 ${chapter}-${sequence}`
    node.attrs = { ...node.attrs, label }
    const figureId = node.attrs.figureId
    if (typeof figureId === "string" && figureId) labels.set(figureId, label)
  })
  visit(document, (node) => {
    if (node.type !== "figureReference") return
    const figureId = String(node.attrs?.figureId ?? "")
    node.attrs = {
      ...node.attrs,
      label: labels.get(figureId) ?? "图（引用失效）",
    }
  })
  return document
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
    if (child.type === "figureReference") {
      const figureId = child.attrs?.figureId
      if (typeof figureId !== "string" || !/^fig-[A-Za-z0-9_-]{8,96}$/.test(figureId)) {
        throw new TypeError("正文包含无效的图片引用。")
      }
      const token: StructuredRun = {
        text: `{{fig:${figureId}}}`,
        bold: false,
        italic: false,
        script: "normal",
      }
      const previous = runs.at(-1)
      if (previous && sameRunStyle(previous, token)) previous.text += token.text
      else runs.push(token)
      continue
    }
    if (child.type !== "text") {
      throw new TypeError(`正文段落包含不受支持的节点：${child.type ?? "未知"}。`)
    }
    const text = child.text ?? ""
    if (!text) continue
    const style = styleForTextNode(child)
    for (const expanded of expandLegacyScientificText(text, style)) {
      const previous = runs.at(-1)
      if (previous && sameRunStyle(previous, expanded)) {
        previous.text += expanded.text
      } else {
        runs.push(expanded)
      }
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

function imageFromTiptap(node: JSONContent): StructuredImageBlock {
  const attrs = node.attrs ?? {}
  const image: StructuredImageBlock = {
    type: "image",
    path: String(attrs.path ?? ""),
    alt: String(attrs.alt ?? ""),
    width_mm: Number(attrs.widthMm ?? 120),
    chapter: Number(attrs.chapter ?? 1),
    caption: (attrs.caption ?? "") as ParagraphInput,
  }
  if (typeof attrs.figureId === "string" && attrs.figureId) image.id = attrs.figureId
  if (typeof attrs.sourceCitationKey === "string" && attrs.sourceCitationKey) {
    image.source_citation_key = attrs.sourceCitationKey
  }
  return image
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
    if (node.type === "figureBlock") {
      blocks.push(imageFromTiptap(node))
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

    if (node.type.name === "figureBlock") {
      if (mode !== "body") valid = false
      return
    }

    if (node.type.name === "figureReference") {
      if (mode !== "body") valid = false
      return
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

function figureLabelPlugin(numbering: FigureNumberingContext) {
  return new Plugin({
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((transaction) => transaction.docChanged)) return null
      const counters = new Map<number, number>(
        Object.entries(numbering.startCounts ?? {}).map(([chapter, count]) => [Number(chapter), count]),
      )
      const labels = new Map<string, string>(Object.entries(numbering.knownLabels ?? {}))
      const figureUpdates: Array<{ position: number; label: string }> = []
      newState.doc.descendants((node, position) => {
        if (node.type.name !== "figureBlock") return
        const chapter = Number.isInteger(node.attrs.chapter) && node.attrs.chapter > 0
          ? Number(node.attrs.chapter)
          : 1
        const sequence = (counters.get(chapter) ?? 0) + 1
        counters.set(chapter, sequence)
        const label = `图 ${chapter}-${sequence}`
        if (typeof node.attrs.figureId === "string" && node.attrs.figureId) {
          labels.set(node.attrs.figureId, label)
        }
        if (node.attrs.label !== label) figureUpdates.push({ position, label })
      })
      const referenceUpdates: Array<{ position: number; label: string }> = []
      newState.doc.descendants((node, position) => {
        if (node.type.name !== "figureReference") return
        const label = labels.get(String(node.attrs.figureId)) ?? "图（引用失效）"
        if (node.attrs.label !== label) referenceUpdates.push({ position, label })
      })
      if (!figureUpdates.length && !referenceUpdates.length) return null
      const transaction = newState.tr
      for (const update of [...figureUpdates, ...referenceUpdates]) {
        const node = transaction.doc.nodeAt(update.position)
        if (node) transaction.setNodeMarkup(update.position, undefined, { ...node.attrs, label: update.label })
      }
      return transaction.docChanged ? transaction : null
    },
  })
}

function createFigureBlock(numbering: FigureNumberingContext) {
  return Node.create({
    name: "figureBlock",
    group: "block",
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes() {
      return {
        figureId: { default: "" },
        path: { default: "" },
        previewUrl: { default: "" },
        alt: { default: "" },
        chapter: { default: 1 },
        widthMm: { default: 120 },
        caption: { default: "" },
        captionText: { default: "" },
        sourceCitationKey: { default: "" },
        label: { default: "图（待编号）" },
      }
    },
    parseHTML() {
      return [{ tag: "figure[data-figure-id]" }]
    },
    renderHTML({ node }) {
      const caption = `${node.attrs.label}${node.attrs.captionText ? ` ${node.attrs.captionText}` : ""}`
      const source = node.attrs.sourceCitationKey ? ` [${node.attrs.sourceCitationKey}]` : ""
      const children: unknown[] = [
        "figure",
        { "data-figure-id": node.attrs.figureId, "data-chapter": node.attrs.chapter },
      ]
      if (node.attrs.previewUrl) {
        children.push(["img", { src: node.attrs.previewUrl, alt: node.attrs.alt }])
      } else {
        children.push(["div", { "data-figure-placeholder": "" }, `图片：${node.attrs.alt}`])
      }
      children.push(["figcaption", {}, caption + source])
      return children as never
    },
    addProseMirrorPlugins() {
      return [figureLabelPlugin(numbering)]
    },
  })
}

const FigureReference = Node.create({
  name: "figureReference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { figureId: { default: "" }, label: { default: "图（待编号）" } }
  },
  parseHTML() {
    return [{ tag: "span[data-figure-reference]" }]
  },
  renderHTML({ node }) {
    return [
      "span",
      { "data-figure-reference": node.attrs.figureId, class: node.attrs.label.includes("失效") ? "text-destructive" : "" },
      node.attrs.label,
    ]
  },
})

function toggleSubscript(editor: Editor): boolean {
  const chain = editor.chain().focus()
  if (editor.isActive("subscript")) return chain.unsetSubscript().run()
  return chain.unsetSuperscript().setSubscript().run()
}

function toggleSuperscript(editor: Editor): boolean {
  const chain = editor.chain().focus()
  if (editor.isActive("superscript")) return chain.unsetSuperscript().run()
  return chain.unsetSubscript().setSuperscript().run()
}

function createRestrictedDocumentBehavior(mode: StructuredEditorMode) {
  return Extension.create({
    name: `restrictedDocumentBehavior-${mode}`,
    priority: 1_000,
    addKeyboardShortcuts() {
      return {
        "Mod-Shift--": () => toggleSubscript(this.editor),
        "Mod-Shift-_": () => toggleSubscript(this.editor),
        "Mod-Shift-+": () => toggleSuperscript(this.editor),
        "Mod-Shift-=": () => toggleSuperscript(this.editor),
        "Mod-z": () => this.editor.commands.undo(),
        "Mod-y": () => this.editor.commands.redo(),
        "Mod-Shift-z": () => this.editor.commands.redo(),
        ...(mode === "inline"
          ? {
              Enter: () => true,
              "Shift-Enter": () => true,
            }
          : {}),
        Tab: () => {
          if (mode === "inline") return false
          if (mode !== "body" || !this.editor.isActive("listItem")) return true
          if (listDepthAtSelection(this.editor) >= MAX_STRUCTURED_LIST_DEPTH) {
            return true
          }
          this.editor.commands.sinkListItem("listItem")
          return true
        },
        "Shift-Tab": () => {
          if (mode === "inline") return false
          if (this.editor.isActive("listItem")) {
            this.editor.commands.liftListItem("listItem")
          }
          return true
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
  figureNumbering: FigureNumberingContext = {},
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
    ...(listsEnabled ? [createFigureBlock(figureNumbering), FigureReference] : []),
    Subscript,
    Superscript,
    createRestrictedDocumentBehavior(mode),
  ]
}
