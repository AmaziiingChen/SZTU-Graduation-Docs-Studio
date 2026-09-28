import { Extension } from "@tiptap/react"
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Plugin } from "@tiptap/pm/state"
import { parseMathSource } from "@/lib/process-math-source"

function unescapedDollar(text: string, index: number): boolean {
  if (text[index] !== "$") return false
  let slashes = 0
  for (let position = index - 1; position >= 0 && text[position] === "\\"; position -= 1) slashes += 1
  return slashes % 2 === 0
}

function inlineRange(text: string): { from: number; to: number; source: string } | null {
  for (let start = 0; start < text.length; start += 1) {
    if (!unescapedDollar(text, start) || text[start + 1] === "$" || text[start - 1] === "$") continue
    for (let end = start + 1; end < text.length; end += 1) {
      if (!unescapedDollar(text, end)) continue
      if (text[end + 1] === "$" || text[end - 1] === "$") break
      const source = text.slice(start + 1, end)
      try { parseMathSource(source); return { from: start, to: end + 1, source } }
      catch { break }
    }
  }
  return null
}

function paragraphInlineRange(paragraph: ProseMirrorNode) {
  let segment = ""
  let segmentStart = 0
  let found: ReturnType<typeof inlineRange> = null
  paragraph.forEach((child, offset) => {
    if (found) return
    if (child.isText) {
      if (!segment) segmentStart = offset
      segment += child.text ?? ""
      return
    }
    const range = inlineRange(segment)
    if (range) found = { ...range, from: segmentStart + range.from, to: segmentStart + range.to }
    segment = ""
  })
  if (!found) {
    const range = inlineRange(segment)
    if (range) found = { ...range, from: segmentStart + range.from, to: segmentStart + range.to }
  }
  return found
}

export function createProcessMathLivePreview(allowDisplay: boolean) {
  return Extension.create({
    name: "processMathLivePreview",
    addProseMirrorPlugins() {
      return [new Plugin({
        appendTransaction(transactions, _oldState, state) {
          if (!transactions.some(transaction => transaction.docChanged)) return null
          const { schema } = state
          const change = state.tr
          // One paste can contain several formulas. Convert them in the same undoable transaction.
          for (let iteration = 0; iteration < 50; iteration += 1) {
            const doc = change.doc
            let converted = false
            if (allowDisplay) {
              let position = 0
              for (let index = 0; index < doc.childCount; index += 1) {
                const first = doc.child(index)
                if (first.type.name !== "paragraph" || first.childCount > 1 || (first.childCount === 1 && !first.firstChild?.isText)) {
                  position += first.nodeSize
                  continue
                }
                const beginning = first.textContent
                if (!beginning.startsWith("$$")) { position += first.nodeSize; continue }
                let endIndex = index
                const lines = [beginning]
                let endPosition = position + first.nodeSize
                while (!lines.at(-1)?.endsWith("$$") || lines.at(-1) === "$$") {
                  if (endIndex + 1 >= doc.childCount || doc.child(endIndex + 1).type.name !== "paragraph") break
                  endIndex += 1
                  const next = doc.child(endIndex)
                  if (next.childCount > 1 || (next.childCount === 1 && !next.firstChild?.isText)) break
                  lines.push(next.textContent)
                  endPosition += next.nodeSize
                  if (next.textContent.endsWith("$$") && next.textContent !== "$$") break
                  if (next.textContent === "$$" && endIndex > index) break
                }
                const last = lines.at(-1) ?? ""
                if (!last.endsWith("$$") || (lines.length === 1 && beginning.length <= 4)) { position += first.nodeSize; continue }
                const source = lines.join("\n").slice(2, -2).trim()
                try {
                  const expression = parseMathSource(source)
                  const block = schema.nodes.processEquation.create({ block: { type: "equation", expression, alt: source } })
                  const replacement = endIndex === doc.childCount - 1
                    ? Fragment.fromArray([block, schema.nodes.paragraph.create()]) : block
                  change.replaceWith(position, endPosition, replacement)
                  converted = true
                  break
                } catch { /* Invalid or incomplete input remains editable text. */ }
                position += first.nodeSize
              }
            }
            if (converted) continue
            let result: { position: number; range: NonNullable<ReturnType<typeof inlineRange>> } | null = null
            doc.descendants((node: ProseMirrorNode, position: number) => {
              if (result || node.type.name !== "paragraph" || !node.childCount) return
              const range = paragraphInlineRange(node)
              if (range) result = { position, range }
            })
            if (!result) break
            const { position, range } = result as { position: number; range: NonNullable<ReturnType<typeof inlineRange>> }
            const expression = parseMathSource(range.source)
            const inline = schema.nodes.inlineEquation.create({ run: { type: "inline_equation", expression, alt: range.source } })
            change.replaceWith(position + 1 + range.from, position + 1 + range.to, inline)
          }
          return change.docChanged ? change : null
        },
      })]
    },
  })
}
