import { parseBibtex } from "@/lib/bibtex"
import { structuredFigureCatalog, structuredFigureChapterCounts, isStructuredBodyValue } from "@/lib/structured-content-editor"
import type { StructuredBodyValue } from "@/types/structured-content"
import { isEquation } from "@/lib/thesis-nodes"

export type ThesisChapter = { id: string; level: number; title: string; body: StructuredBodyValue }
export type ThesisDraft = {
  version: 1
  englishTitle: string
  submissionDate: string
  abstractCn: StructuredBodyValue
  keywordsCn: string
  abstractEn: StructuredBodyValue
  keywordsEn: string
  chapters: ThesisChapter[]
  referencesBibtex: string
  acknowledgements: StructuredBodyValue
  appendix: StructuredBodyValue
}
export function emptyThesisDraft(): ThesisDraft {
  return { version: 1, englishTitle: "", submissionDate: "", abstractCn: [], keywordsCn: "", abstractEn: [], keywordsEn: "", chapters: [], referencesBibtex: "", acknowledgements: [], appendix: [] }
}
export function readThesisDraft(value: unknown): ThesisDraft {
  if (value === undefined) return emptyThesisDraft()
  if (!value || typeof value !== "object") throw new Error("毕业论文草稿格式无效，已停止加载以保护原内容。")
  const d = value as ThesisDraft
  const ids = new Set<string>()
  let previous = 0
  if (d.version !== 1 || (d.submissionDate !== undefined && (typeof d.submissionDate !== "string" || (d.submissionDate !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(d.submissionDate)))) || ![d.englishTitle, d.keywordsCn, d.keywordsEn, d.referencesBibtex].every(v => typeof v === "string") ||
      ![d.abstractCn, d.abstractEn, d.acknowledgements, d.appendix].every(isStructuredBodyValue) || !Array.isArray(d.chapters) || d.chapters.length > 200) {
    throw new Error("毕业论文草稿版本或内容格式不受支持，原内容已保留。")
  }
  for (const c of d.chapters) {
    if (!c || typeof c.id !== "string" || !c.id || ids.has(c.id) || typeof c.title !== "string" || !Number.isInteger(c.level) || c.level < 1 || c.level > 3 || c.level > previous + 1 || !isStructuredBodyValue(c.body)) {
      throw new Error("毕业论文章节存在重复标识、跳级或无效内容，原内容已保留。")
    }
    ids.add(c.id); previous = c.level
  }
  const equationIds = new Set<string>()
  for (const c of d.chapters) for (const b of c.body) if (isEquation(b)) {
    if (equationIds.has(b.id)) throw new Error("公式标识重复，原内容已保留。")
    equationIds.add(b.id)
  }
  const figureIds = new Set<string>()
  let root = 0
  for (const c of d.chapters) {
    if (c.level === 1) root++
    for (const block of c.body) {
      if (typeof block === "string" || (block.type !== "image" && block.type !== "figure_group")) continue
      if (!block.id || figureIds.has(block.id) || block.chapter !== root) throw new Error("图片标识重复或所属章节无效，原内容已保留。")
      figureIds.add(block.id)
    }
  }
  return structuredClone({ ...d, submissionDate: d.submissionDate ?? "" })
}
export function chapterEnd(chapters: ThesisChapter[], index: number) {
  let end = index + 1
  while (end < chapters.length && chapters[end].level > chapters[index].level) end++
  return end
}
export function chapterNumbers(chapters: ThesisChapter[]) {
  const counters = [0, 0, 0]
  return chapters.map(c => {
    counters[c.level - 1]++
    for (let i = c.level; i < 3; i++) counters[i] = 0
    return counters.slice(0, c.level).join(".")
  })
}
export function siblingIndex(chapters: ThesisChapter[], index: number, direction: -1 | 1) {
  if (direction === 1) {
    const next = chapterEnd(chapters, index)
    return chapters[next]?.level === chapters[index].level ? next : -1
  }
  for (let i = index - 1; i >= 0; i--) {
    if (chapters[i].level < chapters[index].level) return -1
    if (chapters[i].level === chapters[index].level) return i
  }
  return -1
}
export function moveChapter(chapters: ThesisChapter[], index: number, direction: -1 | 1) {
  const other = siblingIndex(chapters, index, direction)
  if (other < 0) return chapters
  const left = Math.min(index, other), right = Math.max(index, other)
  const end = chapterEnd(chapters, right)
  return [...chapters.slice(0, left), ...chapters.slice(right, end), ...chapters.slice(left, right), ...chapters.slice(end)]
}

/** Figure ownership follows the chapter tree, never a manually entered chapter number. */
export function normalizeThesisFigures(draft: ThesisDraft): ThesisDraft {
  let root = 0
  return { ...draft, chapters: draft.chapters.map(chapter => {
    if (chapter.level === 1) root++
    return { ...chapter, body: chapter.body.map(block => typeof block !== "string" && (block.type === "image" || block.type === "figure_group") ? { ...block, chapter: root } : block) }
  }) }
}

export function thesisFigureContext(draft: ThesisDraft, index: number) {
  const normalized = normalizeThesisFigures(draft)
  const bodies = normalized.chapters.map(c => c.body)
  const catalog = structuredFigureCatalog(...bodies)
  const root = normalized.chapters.slice(0, index + 1).filter(c => c.level === 1)
  const chapter = root.length || 1
  return {
    chapters: [{ value: chapter, label: `第 ${chapter} 章 ${root.at(-1)?.title || "未命名章节"}` }],
    catalog,
    numbering: { startCounts: structuredFigureChapterCounts(...bodies.slice(0, index)), knownLabels: Object.fromEntries(catalog.map(f => [f.id, f.label])) },
  }
}

export type ThesisReferenceOption = { kind: "cite" | "eq"; target: string; label: string; title: string }
export function thesisReferences(draft: ThesisDraft) {
  const parsed = parseBibtex(draft.referencesBibtex)
  const entries = parsed.issues.length ? [] : parsed.entries.filter(entry => /^[A-Za-z0-9_:.+/-]{1,200}$/.test(entry.citationKey))
  const options: ThesisReferenceOption[] = []
  const labels: Record<string, string> = {}
  const cited: string[] = []
  const missing = new Set<string>()
  const tokens = draft.chapters.flatMap(c => Array.from(referenceText(c.body).matchAll(/\{\{(cite|eq):([A-Za-z0-9_:.+/-]{1,200})\}\}/g), m => ({ kind: m[1], target: m[2] })))
  for (const token of tokens) if (token.kind === "cite" && entries.some(e => e.citationKey === token.target) && !cited.includes(token.target)) cited.push(token.target)
  for (const entry of entries) {
    const n = cited.indexOf(entry.citationKey)
    const label = n < 0 ? "未引用" : `[${n + 1}]`
    labels[`cite:${entry.citationKey}`] = label
    options.push({ kind: "cite", target: entry.citationKey, label, title: `${entry.citationKey} · ${entry.fields.title ?? ""}` })
  }
  let chapter = 0, sequence = 0
  for (const c of draft.chapters) {
    if (c.level === 1) { chapter++; sequence = 0 }
    for (const b of c.body) if (isEquation(b)) {
      const label = `式（${chapter}-${++sequence}）`
      labels[`eq:${b.id}`] = label
      options.push({ kind: "eq", target: b.id, label, title: b.latex.slice(0, 80) })
    }
  }
  for (const token of tokens) if (!labels[`${token.kind}:${token.target}`]) missing.add(`${token.kind === "cite" ? "文献" : "公式"}：${token.target}`)
  return { options, labels, missing: [...missing], citationOrder: cited }
}

function referenceText(body: StructuredBodyValue): string {
  return body.map(block => {
    if (typeof block === "string") return block
    if ("runs" in block) return block.runs.map(run => "text" in run ? run.text : run.alt).join("")
    if (block.type === "ordered_list" || block.type === "unordered_list") return block.items.map(item => referenceText([item.content, ...(item.children ? [item.children] : [])])).join("\n")
    return ""
  }).join("\n")
}
