import type { Editor } from "@tiptap/react"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { closeHistory } from "@tiptap/pm/history"
import { AllSelection, TextSelection, type Transaction } from "@tiptap/pm/state"

type Candidate = {
  node: ProseMirrorNode
  position: number
  prefixLength: number
  indent: string
  kind: "orderedList" | "bulletList"
  number: number
}
type Replacement = { from: number; to: number; items: Candidate[]; node: ProseMirrorNode }

function candidate(node: ProseMirrorNode, position: number): Candidate | undefined {
  if (node.type.name !== "paragraph" || node.attrs.authoringRole === "guidance") return
  let text = ""
  node.forEach(child => { text += child.isText ? child.text! : "\ufffc".repeat(child.nodeSize) })
  // Pasted paragraphs are the unit of recognition. Do not split a multiline
  // paragraph or infer nesting from leading whitespace.
  if (/[\r\n]/.test(text)) return
  const ordered = text.match(/^([ \t]*)([1-9]\d{0,8})\.([ \t]*)(\S.*)$/)
  const bullet = text.match(/^([ \t]*)([-*•])[ \t]+(\S.*)$/)
  if (!ordered && !bullet) return
  const match = ordered ?? bullet!
  const body = ordered ? match[4] : match[3]
  if (ordered && !match[3] && /^\d/.test(body)) return // 1.2, dates, versions
  if (/^(?:\d+(?:\.\d+)+|\d+[.)、]\s|[-+]?\d+(?:\.\d+)?\s*$)/.test(body)) return
  const prefixLength = text.length - body.length
  let protectedPrefix = false
  node.nodesBetween(0, prefixLength, child => {
    if (!child.isText || child.marks.some(mark => ["subscript", "superscript", "code", "link"].includes(mark.type.name))) protectedPrefix = true
  })
  if (protectedPrefix || /^(?:`|\$|\\[[(])/.test(body)) return
  return { node, position, prefixLength, indent: match[1], kind: ordered ? "orderedList" : "bulletList", number: ordered ? Number(match[2]) : 0 }
}

/** Convert only complete, unambiguous top-level paragraph groups to lists. */
export function tidyLists(editor: Editor) {
  const transaction = closeHistory(editor.state.tr)
  const result = appendListCleanup(transaction, editor.isEditable && !editor.view.composing)
  if (transaction.docChanged) {
    editor.view.dispatch(transaction)
    editor.view.dispatch(closeHistory(editor.state.tr))
  }
  return result
}

/** Append to the caller's transaction so combined cleanup is one saved edit. */
export function appendListCleanup(transaction: Transaction, enabled = true) {
  const { selection, doc, storedMarks } = transaction
  const schema = doc.type.schema
  const result = { groups: 0, items: 0, skipped: 0, limited: 0, selected: !selection.empty }
  if (!enabled
    || !(selection instanceof TextSelection || selection instanceof AllSelection)
    || !schema.nodes.orderedList || !schema.nodes.bulletList) return result
  const replacements: Replacement[] = []
  let pending: Candidate[] = []
  const flush = () => {
    if (!pending.length) return
    const items = pending
    pending = []
    if (items.length < 2 || items.some((item, index) => item.indent !== items[0].indent
      || (item.kind === "orderedList" && item.number !== items[0].number + index))) {
      result.skipped += items.length
      return
    }
    // The shared contract allows at most 100 items per list.
    if (items.length > 100) { result.limited += items.length; return }
    const children = items.map(item => schema.nodes.listItem.create(null,
      item.node.type.create(item.node.attrs, item.node.content.cut(item.prefixLength), item.node.marks)))
    const node = schema.nodes[items[0].kind].create(
      items[0].kind === "orderedList" ? { start: items[0].number } : null, children)
    replacements.push({ from: items[0].position, to: items.at(-1)!.position + items.at(-1)!.node.nodeSize, items, node })
    result.groups += 1
    result.items += items.length
  }
  let references = false
  let fence: string | undefined
  let displayMath = false
  doc.forEach((node, position) => {
    if (node.type.name !== "paragraph") { flush(); return }
    const text = node.textContent.trim()
    if (/^(?:参考文献|references)\s*[:：]?$/i.test(text)) references = true
    const fenceMatch = text.match(/^(`{3,}|~{3,})/)
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0]
      else if (fence === fenceMatch[1][0]) fence = undefined
      flush(); return
    }
    if (/^(?:\$\$|\\\[|\\\])$/.test(text)) { displayMath = !displayMath; flush(); return }
    if (references || fence || displayMath || (!selection.empty
      && (position + 1 < selection.from || position + node.nodeSize - 1 > selection.to))) { flush(); return }
    const item = candidate(node, position)
    if (!item) { flush(); return }
    if (pending.length && pending[0].kind !== item.kind) flush()
    pending.push(item)
  })
  flush()
  if (!replacements.length) return result
  const mappingStart = transaction.steps.length
  for (const replacement of [...replacements].reverse()) {
    transaction.replaceWith(replacement.from, replacement.to, replacement.node)
  }
  // Keep the caret/selection on the same body text after removing handwritten
  // prefixes and inserting list wrappers. Default replacement mapping collapses
  // selections to the end of the replaced block.
  const mapPosition = (position: number) => {
    const mapping = transaction.mapping.slice(mappingStart)
    for (const replacement of replacements) {
      let itemOffset = 0
      for (let index = 0; index < replacement.items.length; index += 1) {
        const item = replacement.items[index]
        if (position >= item.position + 1 && position < item.position + item.node.nodeSize) {
          const bodyOffset = Math.max(0, position - item.position - 1 - item.prefixLength)
          return mapping.map(replacement.from, -1) + 3 + itemOffset + bodyOffset
        }
        itemOffset += replacement.node.child(index).nodeSize
      }
    }
    return mapping.map(position)
  }
  transaction.setSelection(selection instanceof AllSelection
    ? new AllSelection(transaction.doc)
    : TextSelection.create(transaction.doc, mapPosition(selection.anchor), mapPosition(selection.head)))
  transaction.setStoredMarks(storedMarks ?? selection.$from.marks())
  return result
}
