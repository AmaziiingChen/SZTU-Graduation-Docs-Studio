import type { OutlineLevel } from "./outline-numbering"

export function parseOutlineText(text: string) {
  const items: { level: OutlineLevel; title: string }[] = []
  const errors: string[] = []
  let skipped = 0
  if (text.length > 100_000) return { items, errors: ["目录文本过长，请控制在 10 万字以内。"], skipped }
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    let line = raw.replace(/^\uFEFF/, "").trim()
    if (!line) continue
    // Only strip unambiguous Word TOC leaders/tab-separated page numbers.
    line = line.replace(/(?:\t+|[.．·…]{2,}\s*)[0-9０-９ivxlcdmIVXLCDM]+\s*$/, "").trim()
    if (/^(?:目\s*录|contents|摘要|abstract|参考文献|致谢)$/i.test(line)) { skipped++; continue }
    line = line.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/．/g, ".")
    const match = line.match(/^(\d+(?:\.\d+)*)(.*)$/)
    if (!match) { errors.push(`第 ${index + 1} 行：未识别到编号和标题，请使用“1 标题”或“1.1 标题”。`); continue }
    const level = match[1].split(".").length
    const title = match[2].replace(/^[.、]?\s*/, "").trim()
    if (!title || title.length > 200) { errors.push(`第 ${index + 1} 行：标题需为 1–200 个字符。`); continue }
    if (/^(摘要|abstract|参考文献|致谢)$/i.test(title)) { skipped++; continue }
    if (level > 6 || (items.length === 0 && level !== 1) || level > (items.at(-1)?.level ?? 0) + 1) {
      errors.push(`第 ${index + 1} 行：层级跳级或超过 6 级，请补齐上级目录。`); continue
    }
    items.push({ level: level as OutlineLevel, title })
  }
  if (items.length > 300) errors.push("目录最多支持一次导入 300 条。")
  return { items, errors, skipped }
}
