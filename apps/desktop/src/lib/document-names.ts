import { assessmentDocumentRegistry } from "@/lib/assessment-documents"
import type { DocumentType } from "@/types/desktop-api"

export const documentTypeLabels: Record<DocumentType, string> = {
  proposal: "开题报告",
  task_book: "任务书",
  midterm: "中期检查表",
  thesis: "毕业论文",
  ...Object.fromEntries(Object.entries(assessmentDocumentRegistry).map(([type, item]) => [type, item.label])) as Record<keyof typeof assessmentDocumentRegistry, string>,
}

export function defaultDocumentTitle(type: DocumentType, studentName: string) {
  const name = studentName.trim()
  return name ? `${name}-${documentTypeLabels[type]}` : documentTypeLabels[type]
}
