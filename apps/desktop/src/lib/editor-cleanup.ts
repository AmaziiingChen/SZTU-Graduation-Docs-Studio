import type { Editor } from "@tiptap/react"
import { closeHistory } from "@tiptap/pm/history"
import { AllSelection, TextSelection, type Transaction } from "@tiptap/pm/state"
import { Transform } from "@tiptap/pm/transform"
import { appendListCleanup } from "@/lib/list-cleanup"

export type EditorCleanupKind = "citations" | "punctuation"
type Span = { from: number; to: number }

const containers = new Set(["doc", "orderedList", "bulletList", "listItem"])
const punctuation: Record<string, string> = { ",": "，", ";": "；", ":": "：" }
const overlaps = (a: Span, b: Span) => a.from < b.to && b.from < a.to

function hasChinesePunctuationContext(text: string, span: Span): boolean {
  // Treat mixed Chinese/Latin prose and model names ending in digits like H7
  // as Chinese punctuation boundaries. Two non-Han neighbors remain unchanged
  // (English prose, thousands separators, times and numeric ratios).
  const left = text.slice(0, span.from).match(/([\p{Script=Han}\p{Script=Latin}\p{Decimal_Number}])[ \t]*$/u)?.[1]
  const right = text.slice(span.to).match(/^[ \t]*([\p{Script=Han}\p{Script=Latin}\p{Decimal_Number}])/u)?.[1]
  return Boolean(left && right && /\p{Script=Han}/u.test(left + right))
}

/** Protect source fragments even when pasted as ordinary text rather than editor atoms. */
function protectedSpans(text: string, kind: EditorCleanupKind): Span[] {
  const spans: Span[] = []
  const patterns = [
    /(?:https?:\/\/|www\.|doi\s*:\s*|10\.\d{4,9}\/)[^\s<>，。！？；：“”‘’]+/gi,
    /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,
    /`[^`]*(?:`|$)/g,
    /(?<!\\)\${1,2}[\s\S]*?(?:(?<!\\)\${1,2}|$)/g,
    /\\\([\s\S]*?(?:\\\)|$)|\\\[[\s\S]*?(?:\\\]|$)/g,
    /\\[A-Za-z]+(?:\{[^}]*\})*/g,
  ]
  if (kind === "punctuation") patterns.push(/\[[^\]]*(?:\]|$)/g)
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      spans.push({ from: match.index, to: match.index + match[0].length })
    }
  }
  return spans
}

function ambiguousCitation(text: string, from: number, to: number): boolean {
  const prefix = (text.slice(0, from).split(/[。！？；;\n]/).at(-1) ?? "")
    .replace(/(?:\[\s*[1-9]\d*(?:\s*[-,]\s*[1-9]\d*)*\s*\]\s*)+$/, "")
  return /(?:区间|范围|取值|数组|矩阵|向量|坐标|下标|索引|文献|reference|interval|range|array|matrix|vector|index)\s*[^\x5b\x5d]{0,16}$/i.test(prefix)
    || /(?:\b(?:arr|data|list)|[∈∉∪∩_=+*/\\^])\s*$/i.test(prefix)
    || text[from - 1] === "[" || text[to] === "]"
}

export type CleanupOptions = { citations?: boolean; punctuation?: boolean; lists?: boolean }

/**
 * Apply the selected local edits without flattening the canonical rich content.
 * Positions are paragraph offsets (including inline atoms), not offsets within
 * individual text runs, so split bold/italic citation markers remain intact.
 * All operations share a transaction, one change event and one undo.
 */
export function tidyFormatting(editor: Editor, options: CleanupOptions = {}) {
  const { citations: runCitations = true, punctuation: runPunctuation = true, lists: runLists = true } = options
  const transaction = closeHistory(editor.state.tr)
  const enabled = editor.isEditable && !editor.view.composing
  const idle = { changed: 0, skipped: 0, limited: 0, selected: !transaction.selection.empty }
  const citations = runCitations ? appendTextCleanup(transaction, "citations", enabled) : idle
  const punctuation = runPunctuation ? appendTextCleanup(transaction, "punctuation", enabled) : idle
  const lists = runLists ? appendListCleanup(transaction, enabled) : { groups: 0, items: 0, ...idle }
  dispatchCleanup(editor, transaction)
  return { citations, punctuation, lists, selected: citations.selected }
}

function dispatchCleanup(editor: Editor, transaction: Transaction) {
  if (!transaction.docChanged) return
  transaction.setStoredMarks(editor.state.storedMarks ?? editor.state.selection.$from.marks())
  editor.view.dispatch(transaction)
  // Separate subsequent typing from this batch as well as prior typing.
  editor.view.dispatch(closeHistory(editor.state.tr))
}

function appendTextCleanup(transaction: Transaction, kind: EditorCleanupKind, enabled: boolean) {
  const { selection, doc } = transaction
  const schema = doc.type.schema
  const result = { changed: 0, skipped: 0, limited: 0, selected: !selection.empty }
  if (!enabled || !(selection instanceof TextSelection || selection instanceof AllSelection)) return result
  const scope = selection.empty ? { from: 0, to: doc.content.size } : selection
  let references = false
  let fenced = false
  let displayMath = false

  doc.descendants((node, position) => {
    if (containers.has(node.type.name)) return true
    if (node.type.name !== "paragraph") return false
    // One placeholder per atom preserves ProseMirror positions and prevents a
    // match from spanning an equation, citation node, image, or other non-text.
    let text = ""
    const protectedMarks: Span[] = []
    node.forEach((child, offset) => {
      text += child.isText ? child.text! : "\ufffc".repeat(child.nodeSize)
      if (child.marks.some(mark => ["code", "link", "subscript"].includes(mark.type.name))) {
        protectedMarks.push({ from: offset, to: offset + child.nodeSize })
      }
    })
    const trimmed = text.trim()
    if (/^(?:参考文献|references)\s*[:：]?$/i.test(trimmed)) references = true
    if (/^\s*(?:```|~~~)/.test(text)) { fenced = !fenced; return false }
    if (/^(?:\$\$|\\\[|\\\])$/.test(trimmed)) { displayMath = !displayMath; return false }
    if (references || fenced || displayMath || node.attrs.authoringRole === "guidance"
      || /^\s*\[\d+\]\s+\S/.test(text) || /^\s*@\w+\s*[{(]/.test(text)) return false
    const protectedRanges = [...protectedSpans(text, kind), ...protectedMarks]
    const pattern = kind === "citations"
      ? /\[\s*[1-9]\d*(?:\s*[-,]\s*[1-9]\d*)*\s*\]/g
      : /[,;:]/g
    for (const match of text.matchAll(pattern)) {
      const local = { from: match.index, to: match.index + match[0].length }
      const from = position + 1 + local.from
      const to = position + 1 + local.to
      if (from < scope.from || to > scope.to) continue
      if (kind === "punctuation" && !hasChinesePunctuationContext(text, local)) continue
      if (protectedRanges.some(range => overlaps(range, local))
        || (kind === "citations" && ambiguousCitation(text, local.from, local.to))) {
        result.skipped += 1
        continue
      }
      if (kind === "citations") {
        const mark = schema.marks.superscript
        if (!mark) continue
        let needsMark = false
        doc.nodesBetween(from, to, child => {
          if (child.isText && !mark.isInSet(child.marks)) needsMark = true
        })
        if (!needsMark) continue
        const candidate = new Transform(transaction.doc).addMark(from, to, mark.create())
        // contracts/content-block.schema.json limits a rich paragraph to 100
        // runs. A bulk formatter must not silently create an unexportable draft.
        if ((candidate.doc.nodeAt(position)?.childCount ?? 0) > 100) {
          result.limited += 1
          continue
        }
        for (const step of candidate.steps) transaction.step(step)
      } else {
        // Both characters occupy one UTF-16 position. Keep the original marks
        // explicitly instead of inheriting formatting from the preceding run.
        const marks = node.nodeAt(local.from)?.marks ?? []
        transaction.replaceWith(from, to, schema.text(punctuation[match[0]], marks))
      }
      result.changed += 1
    }
    return false
  })
  return result
}
