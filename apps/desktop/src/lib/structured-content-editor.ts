import { EquationBlock, ThesisReference, isEquation } from "@/lib/thesis-nodes"
import { InlineEquationNode, ProcessEquationNode, isInlineEquation, isProcessEquation } from "@/lib/process-equation"
import { createProcessMathLivePreview } from "@/lib/process-math-live-preview"
import Subscript from "@tiptap/extension-subscript"
import Superscript from "@tiptap/extension-superscript"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
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
  StructuredFigureGroupBlock,
  StructuredDataTableBlock,
  StructuredListBlock,
  StructuredRun,
  ParagraphRun,
} from "@/types/structured-content"

export const MAX_STRUCTURED_LIST_DEPTH = 4
export type StructuredEditorMode = "body" | "paragraphs" | "inline"
export const AUTHORING_GUIDANCE_COMPOSITION = "authoringGuidanceComposition"
const guidancePluginKey = new PluginKey<boolean>("authoringGuidance")

/** View-only paragraph semantics; never written into canonical body blocks or HTML. */
const AuthoringGuidance = Extension.create({
  name: "authoringGuidance",
  addGlobalAttributes() {
    return [{ types: ["paragraph"], attributes: { authoringRole: { default: null, rendered: false, keepOnSplit: false } } }]
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      key: guidancePluginKey,
      state: {
        init: () => false,
        apply: (transaction, composing) => transaction.getMeta(AUTHORING_GUIDANCE_COMPOSITION) ?? composing,
      },
      appendTransaction(transactions, oldState, state) {
        if (guidancePluginKey.getState(state) || !transactions.some(transaction => transaction.docChanged || transaction.getMeta(AUTHORING_GUIDANCE_COMPOSITION) === false)) return null
        const transaction = state.tr
        let retained = false
        let insertedBodyBlock = false
        oldState.doc.forEach((node, position) => {
          if (node.type.name !== "paragraph" || node.attrs.authoringRole !== "guidance") return
          let from = position + 1
          let to = position + node.nodeSize - 1
          for (const change of transactions) {
            from = change.mapping.map(from, -1)
            to = change.mapping.map(to, 1)
          }
          state.doc.nodesBetween(Math.min(from, state.doc.content.size), Math.min(to, state.doc.content.size), current => {
            if (["figureBlock", "dataTableBlock", "equationBlock", "processEquation", "orderedList", "bulletList"].includes(current.type.name)) insertedBodyBlock = true
          })
        })
        state.doc.descendants((node, position, parent) => {
          if (node.type.name !== "paragraph" || node.attrs.authoringRole !== "guidance") return
          // An empty/deleted guide and a guide turned into a list become ordinary
          // body paragraphs. Subsequent typing must not recreate the old role.
          if (parent === state.doc && !retained && !insertedBodyBlock && guidanceParagraphIsTextOnly(node.toJSON()) && paragraphHasText(paragraphFromTiptap(node.toJSON()))) retained = true
          else transaction.setNodeMarkup(position, undefined, { ...node.attrs, authoringRole: null })
        })
        return transaction.docChanged ? transaction : null
      },
    })]
  },
})

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
const ALLOWED_MARK_NAMES = new Set([
  "bold",
  "italic",
  "subscript",
  "superscript",
])

const FormattingMarks = Extension.create({
  name: "formattingMarks",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const decorations: Decoration[] = []
            state.doc.descendants((node, position) => {
              if (node.type.name !== "paragraph") return
              decorations.push(
                Decoration.widget(
                  position + node.nodeSize - 1,
                  () => {
                    const marker = document.createElement("span")
                    marker.className = "formatting-mark"
                    marker.textContent = "¶"
                    marker.setAttribute("aria-hidden", "true")
                    marker.setAttribute("contenteditable", "false")
                    return marker
                  },
                  { side: 1 },
                ),
              )
            })
            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})

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
    paragraph.runs.every((run) => isStructuredRun(run) || isInlineEquation(run))
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

export function isStructuredFigureGroupBlock(value: unknown): value is StructuredFigureGroupBlock {
  if (!value || typeof value !== "object") return false
  const block = value as StructuredFigureGroupBlock
  return block.type === "figure_group" && Array.isArray(block.items) && block.items.length >= 2 && block.items.length <= 4 &&
    block.items.every(item => isStructuredImageBlock({ ...item, type: "image" })) &&
    isStructuredImageBlock({ type: "image", path: "group", alt: "group", id: block.id, chapter: block.chapter, caption: block.caption, source_citation_key: block.source_citation_key }) &&
    isParagraphInput(block.caption) && (block.columns === undefined || (Number.isInteger(block.columns) && block.columns >= 1 && block.columns <= 4))
}

export function isStructuredDataTableBlock(value: unknown): value is StructuredDataTableBlock {
  if (!value || typeof value !== "object") return false
  const block = value as StructuredDataTableBlock
  return block.type === "data_table" && (block.style === undefined || block.style === "grid" || block.style === "three_line") &&
    Array.isArray(block.columns) && block.columns.length >= 2 && block.columns.length <= 8 &&
    block.columns.every(col => col && isParagraphInput(col.header) && (col.alignment === undefined || ["left", "center", "right"].includes(col.alignment)) && (col.width_weight === undefined || (Number.isFinite(col.width_weight) && col.width_weight >= 0.25 && col.width_weight <= 10))) &&
    Array.isArray(block.rows) && block.rows.length >= 1 && block.rows.length <= 40 && block.rows.every(row => row && Array.isArray(row.cells) && row.cells.length === block.columns.length && row.cells.every(isParagraphInput)) &&
    (block.caption === undefined || isParagraphInput(block.caption))
}

/** Runtime guard for the text-only subset exposed by the workbench editor. */
export function isStructuredBodyValue(value: unknown): value is StructuredBodyValue {
  return (
    Array.isArray(value) &&
    value.every(
      (block) =>
        isParagraphInput(block) ||
        isStructuredListBlock(block, 1) ||
        isEquation(block) || isProcessEquation(block) || isStructuredImageBlock(block) || isStructuredFigureGroupBlock(block) || isStructuredDataTableBlock(block),
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
  for (const match of text.matchAll(/\{\{(fig|cite|eq):([A-Za-z0-9_:.+/-]{1,200})\}\}/g)) {
    if (match[1] === "fig" && !/^fig-[A-Za-z0-9_-]{8,96}$/.test(match[2])) continue
    const index = match.index ?? 0
    if (index > cursor) {
      nodes.push({ type: "text", text: text.slice(cursor, index), ...(marks ? { marks } : {}) })
    }
    nodes.push({
      type: match[1] === "fig" ? "figureReference" : "thesisReference",
      attrs: match[1] === "fig" ? { figureId: match[2], label: "图（待编号）" } : { kind: match[1], target: match[2], label: "引用待编号" },
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
  return paragraph.runs.map((run) => isInlineEquation(run) ? run.alt : run.text).join("")
}

export type StructuredFigureCatalogItem = {
  id: string
  label: string
  caption: string
  chapter: number
}

export type FigureNumberingContext = {
  startCounts?: Readonly<Record<number, number>>
  equationStartCounts?: Readonly<Record<number, number>>
  knownLabels?: Readonly<Record<string, string>>
}

export function structuredFigureCatalog(
  ...bodyGroups: StructuredBodyValue[]
): StructuredFigureCatalogItem[] {
  const counters = new Map<number, number>()
  const catalog: StructuredFigureCatalogItem[] = []
  for (const body of bodyGroups) {
    for (const block of body) {
      if (!isStructuredImageBlock(block) && !isStructuredFigureGroupBlock(block)) continue
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
      if (!isStructuredImageBlock(block) && !isStructuredFigureGroupBlock(block)) continue
      const chapter = block.chapter ?? 1
      counts[chapter] = (counts[chapter] ?? 0) + 1
    }
  }
  return counts
}

export function structuredProcessEquationLabels(...bodyGroups: StructuredBodyValue[]): Record<string, string> {
  const counts = new Map<number, number>()
  const labels: Record<string, string> = {}
  for (const body of bodyGroups) for (const block of body) {
    if (!isProcessEquation(block) || !block.id) continue
    const chapter = block.chapter ?? 1
    const sequence = (counts.get(chapter) ?? 0) + 1
    counts.set(chapter, sequence)
    labels[`eq:${block.id}`] = `(${chapter}-${sequence})`
  }
  return labels
}

export function structuredProcessEquationChapterCounts(...bodyGroups: StructuredBodyValue[]): Record<number, number> {
  const counts: Record<number, number> = {}
  for (const body of bodyGroups) for (const block of body) {
    if (!isProcessEquation(block) || !block.id) continue
    const chapter = block.chapter ?? 1
    counts[chapter] = (counts[chapter] ?? 0) + 1
  }
  return counts
}

export function managedFigurePreviewUrl(imagePath: string): string {
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
  const sourceRuns: ParagraphRun[] =
    typeof paragraph === "string"
      ? [{ text: paragraph, bold: false, italic: false, script: "normal" }]
      : paragraph.runs
  const content = sourceRuns.flatMap((run) =>
    isInlineEquation(run) ? [{ type: "inlineEquation", attrs: { run } }] : expandLegacyScientificText(run.text, run).flatMap((expanded) => {
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
          if (isEquation(block)) return { type: "equationBlock", attrs: { block, label: numbering.knownLabels?.[`eq:${block.id}`] ?? "公式（待编号）" } }
          if (isProcessEquation(block)) return { type: "processEquation", attrs: { block } }
          if (isStructuredDataTableBlock(block)) return { type: "dataTableBlock", attrs: { block } }
          if (isStructuredFigureGroupBlock(block)) return { type: "figureBlock", attrs: {
            figureId: block.id ?? "", chapter: block.chapter ?? 1, groupItems: block.items, groupColumns: block.columns ?? block.items.length,
            caption: block.caption, captionText: paragraphPlainText(block.caption), sourceCitationKey: block.source_citation_key ?? "",
          } }
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
    if (node.type === "thesisReference") { node.attrs = { ...node.attrs, label: labels.get(`${node.attrs?.kind}:${node.attrs?.target}`) ?? "引用失效" }; return }
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

  const runs: ParagraphRun[] = []
  for (const child of node.content ?? []) {
    if (child.type === "inlineEquation") {
      if (!isInlineEquation(child.attrs?.run)) throw new TypeError("行内公式数据无效。")
      runs.push(child.attrs.run)
      continue
    }
    if (child.type === "thesisReference") {
      const { kind, target } = child.attrs ?? {}
      if (!["cite", "eq"].includes(kind) || !/^[A-Za-z0-9_:.+/-]{1,200}$/.test(target)) throw new TypeError("引用目标无效。")
      runs.push({ text: `{{${kind}:${target}}}`, bold: false, italic: false, script: "normal" })
      continue
    }
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
      if (previous && !isInlineEquation(previous) && sameRunStyle(previous, token)) previous.text += token.text
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
      if (previous && !isInlineEquation(previous) && sameRunStyle(previous, expanded)) {
        previous.text += expanded.text
      } else {
        runs.push(expanded)
      }
    }
  }

  const hasFormatting = runs.some(
    (run) => isInlineEquation(run) || run.bold || run.italic || run.script !== "normal",
  )
  if (!hasFormatting) return runs.map((run) => isInlineEquation(run) ? run.alt : run.text).join("")

  return {
    type: "paragraph",
    runs,
  }
}

function imageFromTiptap(node: JSONContent): StructuredImageBlock | StructuredFigureGroupBlock {
  const attrs = node.attrs ?? {}
  if (Array.isArray(attrs.groupItems)) return {
    type: "figure_group", items: attrs.groupItems, columns: Number(attrs.groupColumns),
    ...(attrs.figureId ? { id: String(attrs.figureId) } : {}), chapter: Number(attrs.chapter ?? 1), caption: attrs.caption,
    ...(attrs.sourceCitationKey ? { source_citation_key: String(attrs.sourceCitationKey) } : {}),
  }
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
  return paragraph.runs.some((run) => isInlineEquation(run) || run.text.trim().length > 0)
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
    if (node.type === "equationBlock") {
      if (!isEquation(node.attrs?.block)) throw new TypeError("公式数据无效。")
      blocks.push(node.attrs.block); continue
    }
    if (node.type === "processEquation") {
      if (!isProcessEquation(node.attrs?.block)) throw new TypeError("公式数据无效。")
      blocks.push(node.attrs.block); continue
    }
    if (node.type === "dataTableBlock") {
      if (!isStructuredDataTableBlock(node.attrs?.block)) throw new TypeError("表格数据无效。")
      blocks.push(node.attrs.block)
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

/** Show an optional editable guide and normal body in the same existing editor. */
export function structuredAuthoringToTiptap(value: StructuredBodyValue, numbering: FigureNumberingContext = {}, guidance?: ParagraphInput | null): JSONContent {
  const document = structuredBodyToTiptap(value, numbering)
  if (guidance != null && paragraphHasText(guidance)) {
    document.content?.unshift({ ...paragraphToTiptap(guidance), attrs: { authoringRole: "guidance" } })
  }
  return document
}

function guidanceParagraphIsTextOnly(node: JSONContent): boolean {
  return (node.content ?? []).every(child => child.type === "text")
}

export function tiptapToStructuredAuthoring(document: JSONContent): { body: StructuredBodyValue; guidance: ParagraphInput | null } {
  let guidance: ParagraphInput | null = null
  const content = (document.content ?? []).filter(node => {
    if (node.type !== "paragraph" || node.attrs?.authoringRole !== "guidance" || guidance !== null || !guidanceParagraphIsTextOnly(node)) return true
    const paragraph = paragraphFromTiptap(node)
    if (paragraphHasText(paragraph)) guidance = paragraph
    return false
  })
  return { body: tiptapToStructuredBody({ ...document, content }), guidance }
}

export function structuredAuthoringFingerprint(value: StructuredBodyValue, guidance: ParagraphInput | null): string {
  return JSON.stringify(tiptapToStructuredAuthoring(structuredAuthoringToTiptap(value, {}, guidance)))
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

    if (node.type.name === "figureBlock" || node.type.name === "dataTableBlock") {
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
      if (!transactions.some((transaction) => transaction.docChanged || transaction.getMeta("figureNumbering"))) return null
      const counters = new Map<number, number>(
        Object.entries(numbering.startCounts ?? {}).map(([chapter, count]) => [Number(chapter), count]),
      )
      const labels = new Map<string, string>(Object.entries(numbering.knownLabels ?? {}))
      const figureUpdates: Array<{ position: number; label: string }> = []
      const equationCounts = new Map<number, number>(
        Object.entries(numbering.equationStartCounts ?? {}).map(([chapter, count]) => [Number(chapter), count]),
      )
      newState.doc.descendants((node, position) => {
        if (node.type.name === "processEquation" && isProcessEquation(node.attrs.block)) {
          const block = node.attrs.block
          if (block.id) {
            const chapter = block.chapter ?? 1
            const sequence = (equationCounts.get(chapter) ?? 0) + 1
            equationCounts.set(chapter, sequence)
            labels.set(`eq:${block.id}`, `(${chapter}-${sequence})`)
          }
          return
        }
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
        if (node.type.name === "thesisReference" || node.type.name === "equationBlock") {
          const key = node.type.name === "equationBlock" ? `eq:${node.attrs.block.id}` : `${node.attrs.kind}:${node.attrs.target}`
          const label = labels.get(key) ?? "引用失效"
          if (node.attrs.label !== label) referenceUpdates.push({ position, label })
          return
        }
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
        groupItems: { default: null },
        groupColumns: { default: 2 },
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
      return [{ tag: "figure[data-figure-id]", getAttrs: element => {
        try {
          const block = JSON.parse(element.getAttribute("data-figure-block") ?? "null")
          if (!isStructuredImageBlock(block) && !isStructuredFigureGroupBlock(block)) return false
          return structuredBodyToTiptap([block]).content![0].attrs ?? false
        } catch { return false }
      } }]
    },
    renderHTML({ node }) {
      const caption = `${node.attrs.label}${node.attrs.captionText ? ` ${node.attrs.captionText}` : ""}`
      const source = node.attrs.sourceCitationKey ? ` [${node.attrs.sourceCitationKey}]` : ""
      const children: unknown[] = [
        "figure",
        { "data-figure-id": node.attrs.figureId, "data-chapter": node.attrs.chapter, "data-figure-block": JSON.stringify(imageFromTiptap(node.toJSON())) },
      ]
      if (Array.isArray(node.attrs.groupItems)) {
        const classes = ["", "grid-cols-1", "grid-cols-2", "grid-cols-3", "grid-cols-4"]
        children.push(["div", { class: `grid gap-3 ${classes[node.attrs.groupColumns] ?? "grid-cols-2"}` }, ...node.attrs.groupItems.map((item: StructuredFigureGroupBlock["items"][number], index: number) =>
          ["div", {}, ["img", { src: managedFigurePreviewUrl(item.path), alt: item.alt, class: "max-h-64 w-full object-contain" }], ["p", { class: "text-center text-sm" }, `(${String.fromCharCode(97 + index)}) ${paragraphPlainText(item.caption)}`]])])
      } else if (node.attrs.previewUrl) {
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

const DataTableBlock = Node.create({
  name: "dataTableBlock", group: "block", atom: true, selectable: true, draggable: true,
  addAttributes() { return { block: { default: null } } },
  parseHTML() { return [{ tag: "figure[data-table-block]", getAttrs: element => {
    try {
      const block = JSON.parse(element.getAttribute("data-table-block") ?? "null")
      return isStructuredDataTableBlock(block) ? { block } : false
    } catch { return false }
  } }] },
  renderHTML({ node }) {
    const block = node.attrs.block as StructuredDataTableBlock
    const threeLine = block.style === "three_line"
    return ["figure", { "data-table-block": JSON.stringify(block), class: "overflow-x-auto" },
      ["table", { class: "w-full border-collapse text-sm" },
        ["thead", {}, ["tr", {}, ...block.columns.map(col => ["th", { class: threeLine ? "border-y p-2" : "border p-2" }, paragraphPlainText(col.header)])]],
        ["tbody", {}, ...block.rows.map((row, i) => ["tr", {}, ...row.cells.map((cell, j) => ["td", { class: threeLine ? `p-2 ${i === block.rows.length - 1 ? "border-b" : ""}` : "border p-2", style: `text-align:${block.columns[j].alignment ?? "left"}` }, paragraphPlainText(cell)])])]],
      ["figcaption", {}, paragraphPlainText(block.caption)]] as never
  },
})

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
  enableProcessEquations = false,
  guidanceMode = false,
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
    ...(listsEnabled ? [createFigureBlock(figureNumbering), DataTableBlock, FigureReference] : []),
    ...(listsEnabled ? [EquationBlock, ProcessEquationNode, ThesisReference] : []),
    ...(mode !== "inline" ? [InlineEquationNode] : []),
    ...(enableProcessEquations && mode !== "inline" ? [createProcessMathLivePreview(mode === "body")] : []),
    Subscript,
    Superscript,
    FormattingMarks,
    ...(guidanceMode ? [AuthoringGuidance] : []),
    createRestrictedDocumentBehavior(mode),
  ]
}
