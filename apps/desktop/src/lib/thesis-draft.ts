import { isStructuredBodyValue } from "@/lib/structured-content-editor"
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
