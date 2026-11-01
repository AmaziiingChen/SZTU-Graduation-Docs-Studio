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
    return Object.values(taskScheduleItemErrors(item)).map(message => `第 ${index + 1} 项${message}`)
  })
}

function schedulePeriodError(period: string): string | undefined {
  // A shortened Chinese end date inherits the start year/month. Cross-year
  // ranges must supply the end year; never guess the next year from the order.
  const chinese = /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(?:[—–－~～-]+|至|到)\s*(?:(\d{4})年)?(?:(\d{1,2})月)?(\d{1,2})日$/.exec(period)
  const numeric = /^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})\s*(?:[—–－~～-]+|至|到)\s*(\d{4})([-/.])(\d{1,2})\6(\d{1,2})$/.exec(period)
  let start: number[]
  let end: number[]
  if (chinese) {
    start = chinese.slice(1, 4).map(Number)
    end = [Number(chinese[4] ?? chinese[1]), Number(chinese[5] ?? chinese[2]), Number(chinese[6])]
  } else if (numeric) {
    start = [Number(numeric[1]), Number(numeric[3]), Number(numeric[4])]
    end = [Number(numeric[5]), Number(numeric[7]), Number(numeric[8])]
  } else {
    return "请填写具体起止日期，例如：2026年11月1日—11月15日。"
  }
  const validDate = ([year, month, day]: number[]) => {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    return year >= 1000 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
  }
  if (!validDate(start) || !validDate(end)) return "日期无效，请检查年、月、日。"
  const order = ([year, month, day]: number[]) => year * 10000 + month * 100 + day
  if (order(end) < order(start)) return "结束日期不能早于开始日期；跨年时请写明结束年份。"
  return undefined
}

export function taskScheduleItemErrors(item: TaskScheduleEditorItem): { period?: string; content?: string } {
  const errors: { period?: string; content?: string } = {}
  const period = item.period.trim()
  const content = paragraphInputText(item.content).trim()
  if (!period) errors.period = "缺少时间范围。"
  else if (period.length > 50) errors.period = "时间范围最多 50 个字符。"
  else {
    const periodError = schedulePeriodError(period)
    if (periodError) errors.period = periodError
  }
  if (!content) errors.content = "缺少进度内容。"
  else if (content.length > 1500) errors.content = "进度内容最多 1500 个字符。"
  return errors
}
