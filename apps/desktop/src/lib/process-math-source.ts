import type { MathExpression } from "@/types/structured-content"
import { isMathExpression } from "@/lib/math-expression"

const SYMBOLS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", zeta: "ζ",
  eta: "η", theta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ",
  nu: "ν", xi: "ξ", omicron: "ο", pi: "π", rho: "ρ", sigma: "σ",
  tau: "τ", upsilon: "υ", phi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π",
  Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  times: "×", cdot: "·", leq: "≤", geq: "≥",
}

const SUPPORTED_CHARACTER = /^[A-Za-z0-9α-ωΓΔΘΛΞΠΣΥΦΨΩ+\-−=×·/(),.<>≤≥%|:]$/u

export function parseMathSource(source: string): MathExpression {
  if (!source.trim() || source.length > 500) throw new Error("公式应为 1–500 个字符。")
  let position = 0
  const text = (value: string): MathExpression => ({ type: "text", value })
  const group = (items: MathExpression[]): MathExpression => items.length === 1 ? items[0] : { type: "row", items }
  const argument = (): MathExpression => {
    if (source[position] !== "{") return atom()
    position += 1
    const expression = sequence(true)
    if (source[position] !== "}") throw new Error("公式的花括号没有闭合。")
    position += 1
    return expression
  }
  const atom = (): MathExpression => {
    const character = source[position]
    if (!character) throw new Error("公式缺少底数、分子或上下标内容。")
    if (character === "{") return argument()
    if (character === "\\") {
      position += 1
      const match = /^[A-Za-z]+/.exec(source.slice(position))
      if (!match) throw new Error("反斜杠后需要可识别的公式命令。")
      position += match[0].length
      if (match[0] === "frac") return { type: "fraction", numerator: argumentInBraces(), denominator: argumentInBraces() }
      if (match[0] === "sqrt") return { type: "square_root", body: argumentInBraces() }
      const symbol = SYMBOLS[match[0]]
      if (!symbol) throw new Error(`暂不支持 \\${match[0]}，请改用受支持的符号。`)
      return text(symbol)
    }
    if (!SUPPORTED_CHARACTER.test(character) && character !== "[" && character !== "]") throw new Error(`公式包含不支持的字符：${character}`)
    position += 1
    return text(character)
  }
  const argumentInBraces = (): MathExpression => {
    if (source[position] !== "{") throw new Error("分式和根号的内容需要用 { } 包围。")
    return argument()
  }
  const sequence = (nested = false): MathExpression => {
    const items: MathExpression[] = []
    while (position < source.length && source[position] !== "}") {
      if (/\s/.test(source[position])) { position += 1; continue }
      if (source[position] === "^" || source[position] === "_") {
        if (!items.length) throw new Error("上下标前需要底数。")
        const operator = source[position++]
        const base = items.pop()!
        const script = argument()
        items.push(operator === "^" ? { type: "superscript", base, super: script } : { type: "subscript", base, sub: script })
        continue
      }
      const next = atom()
      const previous = items.at(-1)
      // Keep the last symbol separate when a script follows it, while storing
      // ordinary runs compactly within the shared expression-tree limits.
      if (next.type === "text" && previous?.type === "text" && source[position] !== "^" && source[position] !== "_" && previous.value.length + next.value.length <= 100) {
        previous.value += next.value
      } else {
        items.push(next)
      }
    }
    if (nested && !items.length) throw new Error("花括号中不能留空。")
    if (!nested && source[position] === "}") throw new Error("公式存在多余的右花括号。")
    return group(items)
  }
  const expression = sequence()
  if (!isMathExpression(expression)) throw new Error("公式过长或结构过深，请拆分后输入。")
  return expression
}

export function mathExpressionToSource(expression: MathExpression): string {
  const bracket = (value: MathExpression) => `{${mathExpressionToSource(value)}}`
  switch (expression.type) {
    case "text": return expression.value
    case "row": return expression.items.map(mathExpressionToSource).join("")
    case "fraction": return `\\frac${bracket(expression.numerator)}${bracket(expression.denominator)}`
    case "square_root": return `\\sqrt${bracket(expression.body)}`
    case "subscript": return `${expression.base.type === "row" ? bracket(expression.base) : mathExpressionToSource(expression.base)}_${bracket(expression.sub)}`
    case "superscript": return `${expression.base.type === "row" ? bracket(expression.base) : mathExpressionToSource(expression.base)}^${bracket(expression.super)}`
  }
}

export function editableMathSource(expression: MathExpression, alt: string): string {
  try {
    if (JSON.stringify(parseMathSource(alt)) === JSON.stringify(expression)) return alt
  } catch { /* Older formulas used a prose description instead of source. */ }
  return mathExpressionToSource(expression)
}

export function hasUnescapedMathDelimiter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "$") continue
    let slashes = 0
    for (let previous = index - 1; previous >= 0 && text[previous] === "\\"; previous -= 1) slashes += 1
    if (slashes % 2 !== 0) continue
    return true
  }
  return false
}
