import { Node } from "@tiptap/react"
import type { StructuredEquationBlock } from "@/types/structured-content"

export function isEquation(value: unknown): value is StructuredEquationBlock {
  if (!value || typeof value !== "object") return false
  const b = value as StructuredEquationBlock
  return b.type === "equation" && /^eq-[A-Za-z0-9_-]{8,96}$/.test(b.id) && typeof b.latex === "string" && b.latex.trim().length > 0 && b.latex.length <= 10000
}
export const EquationBlock = Node.create({
  name: "equationBlock", group: "block", atom: true, selectable: true,
  addAttributes() { return { block: { default: null }, label: { default: "公式（待编号）" } } },
  parseHTML() { return [{ tag: "figure[data-equation]", getAttrs: element => {
    try { const block = JSON.parse(element.getAttribute("data-equation") ?? "null"); return isEquation(block) ? { block } : false } catch { return false }
  } }] },
  renderHTML({ node }) { return ["figure", { "data-equation": JSON.stringify(node.attrs.block), class: "rounded-md border p-3" }, ["div", { class: "whitespace-pre-wrap break-words" }, String(node.attrs.block?.latex ?? "")], ["figcaption", {}, `${node.attrs.label} · LaTeX 源码`]] },
})
export const ThesisReference = Node.create({
  name: "thesisReference", group: "inline", inline: true, atom: true,
  addAttributes() { return { kind: { default: "cite" }, target: { default: "" }, label: { default: "引用待编号" } } },
  parseHTML() { return [{ tag: "span[data-thesis-reference]", getAttrs: element => {
    const kind = element.getAttribute("data-kind"), target = element.getAttribute("data-target") ?? ""
    return (kind === "cite" || kind === "eq") && /^[A-Za-z0-9_:.+/-]{1,200}$/.test(target) ? { kind, target } : false
  } }] },
  renderHTML({ node }) { return ["span", { "data-thesis-reference": "true", "data-kind": node.attrs.kind, "data-target": node.attrs.target, class: String(node.attrs.label).includes("失效") ? "text-destructive" : "" }, node.attrs.label] },
})
