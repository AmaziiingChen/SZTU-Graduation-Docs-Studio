import type { ParagraphInput } from "@/types/structured-content"
import { paragraphInputText } from "@/lib/paragraph"

export type TaskScheduleEditorItem = {
  id: string
  period: string
  content: ParagraphInput
}

let generatedId = 0

export function createTaskScheduleEditorItem(): TaskScheduleEditorItem {
  generatedId += 1
  return {
    id: `task-schedule-${Date.now()}-${generatedId}`,
    period: "",
    content: "",
  }
}

export function validateTaskScheduleItems(
  value: TaskScheduleEditorItem[],
): string[] {
  if (value.length === 0) return ["进度安排至少需要一项。"]
  if (value.length > 60) return ["进度安排最多支持 60 项。"]
  return value.flatMap((item, index) => {
    const errors: string[] = []
    const period = item.period.trim()
    const content = paragraphInputText(item.content).trim()
    if (!period) errors.push(`第 ${index + 1} 项缺少时间范围。`)
    else if (period.length > 50) {
      errors.push(`第 ${index + 1} 项时间范围最多 50 个字符。`)
    }
    if (!content) errors.push(`第 ${index + 1} 项缺少进度内容。`)
    else if (content.length > 1500) {
      errors.push(`第 ${index + 1} 项进度内容最多 1500 个字符。`)
    }
    return errors
  })
}
