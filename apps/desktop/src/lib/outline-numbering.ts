export type OutlineLevel = 1 | 2 | 3 | 4 | 5 | 6

export type OutlineNumberingStyle =
  | "chinese_hierarchy"
  | "chapter_hierarchy"
  | "chapter_section_hierarchy"
  | "part_chapter_section_hierarchy"
  | "decimal_hierarchy"

export type OutlineNumberingStyleOption = {
  value: OutlineNumberingStyle
  label: string
  example: string
  maxDepth: OutlineLevel
}

export const DEFAULT_OUTLINE_NUMBERING_STYLE: OutlineNumberingStyle =
  "decimal_hierarchy"

export const OUTLINE_NUMBERING_STYLE_OPTIONS: readonly OutlineNumberingStyleOption[] = [
  {
    value: "chinese_hierarchy",
    label: "第一种目录类型",
    example: "一、 → （一） → 1. → (1)",
    maxDepth: 4,
  },
  {
    value: "chapter_hierarchy",
    label: "第二种目录类型",
    example: "第一章 → 一、 → （一） → 1. → (1)",
    maxDepth: 5,
  },
  {
    value: "chapter_section_hierarchy",
    label: "第三种目录类型",
    example: "第一章 → 第一节 → 一、 → （一） → 1. → (1)",
    maxDepth: 6,
  },
  {
    value: "part_chapter_section_hierarchy",
    label: "第四种目录类型",
    example: "第一篇 → 第一章 → 第一节 → 一、 → （一） → 1.",
    maxDepth: 6,
  },
  {
    value: "decimal_hierarchy",
    label: "第五种目录类型",
    example: "1. → 1.1 → 1.1.1",
    maxDepth: 6,
  },
] as const

const STYLE_MAX_DEPTH = new Map(
  OUTLINE_NUMBERING_STYLE_OPTIONS.map((option) => [
    option.value,
    option.maxDepth,
  ]),
)

export function isOutlineNumberingStyle(
  value: unknown,
): value is OutlineNumberingStyle {
  return (
    typeof value === "string" &&
    STYLE_MAX_DEPTH.has(value as OutlineNumberingStyle)
  )
}

export function outlineStyleMaxDepth(
  style: OutlineNumberingStyle,
): OutlineLevel {
  const depth = STYLE_MAX_DEPTH.get(style)
  if (depth === undefined) throw new Error(`不支持的目录编号格式：${style}`)
  return depth
}

export function chineseOutlineNumber(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > 9999) {
    throw new Error("目录序号必须是 1 至 9999 的整数。")
  }
  const digits = "零一二三四五六七八九"
  const units = ["", "十", "百", "千"]
  const source = String(value)
  const parts: string[] = []
  let pendingZero = false
  for (const [index, character] of [...source].entries()) {
    const digit = Number(character)
    const unitIndex = source.length - index - 1
    if (digit === 0) {
      pendingZero = parts.length > 0
      continue
    }
    if (pendingZero) {
      parts.push("零")
      pendingZero = false
    }
    if (!(digit === 1 && unitIndex === 1 && parts.length === 0)) {
      parts.push(digits[digit])
    }
    parts.push(units[unitIndex])
  }
  return parts.join("")
}

function formatCounter(
  style: OutlineNumberingStyle,
  level: OutlineLevel,
  counters: number[],
): string {
  const current = counters[level - 1]
  const chinese = chineseOutlineNumber(current)
  if (style === "decimal_hierarchy") {
    const decimal = counters.slice(0, level).join(".")
    return level === 1 ? `${decimal}.` : decimal
  }
  const patterns: Record<
    Exclude<OutlineNumberingStyle, "decimal_hierarchy">,
    readonly ((value: number, chineseValue: string) => string)[]
  > = {
    chinese_hierarchy: [
      (_value, chineseValue) => `${chineseValue}、`,
      (_value, chineseValue) => `（${chineseValue}）`,
      (value) => `${value}.`,
      (value) => `(${value})`,
    ],
    chapter_hierarchy: [
      (_value, chineseValue) => `第${chineseValue}章`,
      (_value, chineseValue) => `${chineseValue}、`,
      (_value, chineseValue) => `（${chineseValue}）`,
      (value) => `${value}.`,
      (value) => `(${value})`,
    ],
    chapter_section_hierarchy: [
      (_value, chineseValue) => `第${chineseValue}章`,
      (_value, chineseValue) => `第${chineseValue}节`,
      (_value, chineseValue) => `${chineseValue}、`,
      (_value, chineseValue) => `（${chineseValue}）`,
      (value) => `${value}.`,
      (value) => `(${value})`,
    ],
    part_chapter_section_hierarchy: [
      (_value, chineseValue) => `第${chineseValue}篇`,
      (_value, chineseValue) => `第${chineseValue}章`,
      (_value, chineseValue) => `第${chineseValue}节`,
      (_value, chineseValue) => `${chineseValue}、`,
      (_value, chineseValue) => `（${chineseValue}）`,
      (value) => `${value}.`,
    ],
  }
  return patterns[style][level - 1](current, chinese)
}

export function numberOutlineLevels(
  levels: readonly OutlineLevel[],
  style: OutlineNumberingStyle,
): string[] {
  const maximum = outlineStyleMaxDepth(style)
  const counters = Array.from({ length: maximum }, () => 0)
  let previousLevel: OutlineLevel = 1
  return levels.map((level, index) => {
    if (level < 1 || level > maximum) {
      throw new Error(`第 ${index + 1} 条目录层级必须是 1 至 ${maximum}。`)
    }
    if (index === 0 && level !== 1) {
      throw new Error("第一条目录必须是一级目录。")
    }
    if (index > 0 && level > previousLevel + 1) {
      throw new Error(`第 ${index + 1} 条目录不能跳过中间层级。`)
    }
    counters[level - 1] += 1
    counters.fill(0, level)
    previousLevel = level
    return formatCounter(style, level, counters)
  })
}

export function numberOutlineItems<T extends { level: OutlineLevel; number: string }>(
  value: readonly T[],
  style: OutlineNumberingStyle,
): T[] {
  const numbers = numberOutlineLevels(
    value.map((item) => item.level),
    style,
  )
  return value.map((item, index) => ({ ...item, number: numbers[index] }))
}
