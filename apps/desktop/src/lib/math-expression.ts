import type { MathExpression } from "@/types/structured-content"

const MATH_TEXT = /^[A-Za-z0-9αβγδεζηθικλμνξοπρστυφχψωΓΔΘΛΞΠΣΥΦΨΩ +\-−=×·/(),.\u005b\u005d<>≤≥%|:]+$/

export function isMathExpression(value: unknown, depth = 1, counter = { value: 0 }): value is MathExpression {
  counter.value += 1
  if (depth > 8 || counter.value > 100 || !value || typeof value !== "object" || Array.isArray(value)) return false
  const node = value as Record<string, unknown>
  const child = (item: unknown) => isMathExpression(item, depth + 1, counter)
  switch (node.type) {
    case "text": return Object.keys(node).length === 2 && typeof node.value === "string" && node.value.length <= 100 && Boolean(node.value.trim()) && MATH_TEXT.test(node.value)
    case "row": return Object.keys(node).length === 2 && Array.isArray(node.items) && node.items.length >= 1 && node.items.length <= 50 && node.items.every(child)
    case "fraction": return Object.keys(node).length === 3 && child(node.numerator) && child(node.denominator)
    case "subscript": return Object.keys(node).length === 3 && child(node.base) && child(node.sub)
    case "superscript": return Object.keys(node).length === 3 && child(node.base) && child(node.super)
    case "square_root": return Object.keys(node).length === 2 && child(node.body)
    default: return false
  }
}
