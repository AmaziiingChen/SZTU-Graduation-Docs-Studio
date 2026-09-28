import { createElement, useState, type FocusEvent, type ReactNode } from "react"
import { Node, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { isMathExpression } from "@/lib/math-expression"
import { editableMathSource, parseMathSource } from "@/lib/process-math-source"
import type { InlineEquationRun, MathExpression, ProcessEquationBlock } from "@/types/structured-content"

export { isMathExpression } from "@/lib/math-expression"

export function isInlineEquation(value: unknown): value is InlineEquationRun {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const run = value as Record<string, unknown>
  return run.type === "inline_equation" && Object.keys(run).length === 3 && typeof run.alt === "string" && Boolean(run.alt.trim()) && run.alt.length <= 500 && isMathExpression(run.expression)
}

export function isProcessEquation(value: unknown): value is ProcessEquationBlock {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const block = value as Record<string, unknown>
  if (block.type !== "equation" || Object.keys(block).some(key => !["type", "expression", "alt", "id", "chapter"].includes(key))) return false
  if (typeof block.alt !== "string" || !block.alt.trim() || block.alt.length > 500 || !isMathExpression(block.expression)) return false
  if (block.id !== undefined && (typeof block.id !== "string" || !/^eq-[A-Za-z0-9_-]{8,96}$/.test(block.id))) return false
  return block.chapter === undefined || (Number.isInteger(block.chapter) && Number(block.chapter) >= 1 && Number(block.chapter) <= 99)
}

export function mathToDomSpec(node: MathExpression): unknown[] {
  switch (node.type) {
    case "text": return ["mtext", {}, node.value]
    case "row": return ["mrow", {}, ...node.items.map(mathToDomSpec)]
    case "fraction": return ["mfrac", {}, mathToDomSpec(node.numerator), mathToDomSpec(node.denominator)]
    case "subscript": return ["msub", {}, mathToDomSpec(node.base), mathToDomSpec(node.sub)]
    case "superscript": return ["msup", {}, mathToDomSpec(node.base), mathToDomSpec(node.super)]
    case "square_root": return ["msqrt", {}, mathToDomSpec(node.body)]
  }
}

function MathPreview({ expression }: { expression: MathExpression }): ReactNode {
  switch (expression.type) {
    case "text": return createElement("mtext", null, expression.value)
    case "row": return createElement("mrow", null, expression.items.map((item, index) => <MathPreview key={index} expression={item} />))
    case "fraction": return createElement("mfrac", null, <MathPreview expression={expression.numerator} />, <MathPreview expression={expression.denominator} />)
    case "subscript": return createElement("msub", null, <MathPreview expression={expression.base} />, <MathPreview expression={expression.sub} />)
    case "superscript": return createElement("msup", null, <MathPreview expression={expression.base} />, <MathPreview expression={expression.super} />)
    case "square_root": return createElement("msqrt", null, <MathPreview expression={expression.body} />)
  }
}

function EquationView({ editor, node, getPos, updateAttributes }: NodeViewProps) {
  const display = node.type.name === "processEquation"
  const value = display ? node.attrs.block as ProcessEquationBlock : node.attrs.run as InlineEquationRun
  const [editing, setEditing] = useState(false)
  const [source, setSource] = useState(() => editableMathSource(value.expression, value.alt))
  const [error, setError] = useState("")
  const [numbered, setNumbered] = useState(() => display && Boolean((value as ProcessEquationBlock).id))
  const [chapter, setChapter] = useState(() => display ? (value as ProcessEquationBlock).chapter ?? 1 : 1)
  const beginEditing = () => {
    if (!editor.isEditable) return
    setSource(editableMathSource(value.expression, value.alt))
    setNumbered(display && Boolean((value as ProcessEquationBlock).id))
    setChapter(display ? (value as ProcessEquationBlock).chapter ?? 1 : 1)
    setError("")
    setEditing(true)
  }

  const replaceWithSource = () => {
    const position = getPos()
    if (typeof position !== "number") return
    const raw = display ? `$$${source}$$` : `$${source}$`
    const content = display
      ? [{ type: "paragraph", content: [{ type: "text", text: raw }] }]
      : raw
    editor.commands.insertContentAt({ from: position, to: position + node.nodeSize }, content)
  }
  const save = (keepInvalid = false) => {
    try {
      const expression = parseMathSource(source)
      if (display) {
        const previous = value as ProcessEquationBlock
        updateAttributes({ block: {
          type: "equation", expression, alt: source,
          ...(numbered ? { id: previous.id ?? `eq-${crypto.randomUUID()}`, chapter } : {}),
        } })
      }
      else updateAttributes({ run: { ...value, expression, alt: source } })
      setError("")
      setEditing(false)
    } catch (cause) {
      if (keepInvalid) replaceWithSource()
      else setError(cause instanceof Error ? cause.message : "公式写法无效。")
    }
  }
  const inputProps = {
    value: source,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setSource(event.target.value); setError("") },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.key === "Escape") { event.preventDefault(); setSource(editableMathSource(value.expression, value.alt)); setNumbered(display && Boolean((value as ProcessEquationBlock).id)); setChapter(display ? (value as ProcessEquationBlock).chapter ?? 1 : 1); setError(""); setEditing(false) }
      else if (event.key === "Enter" && (!display || event.metaKey || event.ctrlKey)) { event.preventDefault(); save() }
    },
    "aria-label": display ? "编辑行间公式源码" : "编辑行内公式源码",
    autoFocus: true,
  }
  return <NodeViewWrapper
    as={display ? "figure" : "span"}
    className={display ? "rounded-md border p-3 text-center" : "inline-flex align-middle"}
    data-process-equation={display ? JSON.stringify(value) : undefined}
    data-inline-equation={!display ? JSON.stringify(value) : undefined}
    contentEditable={false}
    onBlur={(event: FocusEvent<HTMLElement>) => { if (editing && !event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) save(true) }}
  >
    {editing && editor.isEditable ? <span className={display ? "block" : "inline-block"}>
      {display ? <Textarea {...inputProps} className="min-h-16 text-sm" /> : <Input {...inputProps} className="inline-flex h-8 w-48 max-w-full text-sm" />}
      {display ? <span className="mt-2 flex items-center justify-center gap-2 text-sm">
        <Button type="button" variant={numbered ? "secondary" : "outline"} size="sm" aria-pressed={numbered} onClick={() => setNumbered(current => !current)}>编号与引用</Button>
        {numbered ? <Input aria-label="公式所属章" type="number" min={1} max={99} value={chapter} onChange={event => setChapter(Math.min(99, Math.max(1, Number(event.target.value) || 1)))} className="h-8 w-16" /> : null}
      </span> : null}
      {error ? <span role="alert" className="block text-xs text-destructive">{error}</span> : null}
    </span> : <span
      role={editor.isEditable ? "button" : undefined}
      tabIndex={editor.isEditable ? 0 : undefined}
      aria-label={editor.isEditable ? `编辑${display ? "行间" : "行内"}公式` : value.alt}
      className={editor.isEditable ? "cursor-text rounded-sm focus-visible:outline-2 focus-visible:outline-ring" : undefined}
      onClick={beginEditing}
      onKeyDown={event => { if (editor.isEditable && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); beginEditing() } }}
    >{createElement("math", { display: display ? "block" : undefined }, <MathPreview expression={value.expression} />)}</span>}
  </NodeViewWrapper>
}

export const ProcessEquationNode = Node.create({
  name: "processEquation", group: "block", atom: true, selectable: true,
  addAttributes() { return { block: { default: null } } },
  parseHTML() { return [{ tag: "figure[data-process-equation]", getAttrs: element => {
    try { const block = JSON.parse(element.getAttribute("data-process-equation") ?? "null"); return isProcessEquation(block) ? { block } : false } catch { return false }
  } }] },
  renderHTML({ node }) {
    const block = node.attrs.block as ProcessEquationBlock
    return ["figure", { "data-process-equation": JSON.stringify(block), class: "rounded-md border p-3 text-center", "aria-label": block.alt },
      ["math", { display: "block" }, mathToDomSpec(block.expression)]] as never
  },
  addNodeView() { return ReactNodeViewRenderer(EquationView) },
})

export const InlineEquationNode = Node.create({
  name: "inlineEquation", group: "inline", inline: true, atom: true, selectable: true,
  addAttributes() { return { run: { default: null } } },
  parseHTML() { return [{ tag: "span[data-inline-equation]", getAttrs: element => {
    try { const run = JSON.parse(element.getAttribute("data-inline-equation") ?? "null"); return isInlineEquation(run) ? { run } : false } catch { return false }
  } }] },
  renderHTML({ node }) {
    const run = node.attrs.run as InlineEquationRun
    return ["span", { "data-inline-equation": JSON.stringify(run), "aria-label": run.alt, class: "inline-flex align-middle" },
      ["math", {}, mathToDomSpec(run.expression)]] as never
  },
  addNodeView() { return ReactNodeViewRenderer(EquationView) },
})
