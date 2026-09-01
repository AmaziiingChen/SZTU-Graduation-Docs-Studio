import { Badge } from "@/components/ui/badge"
import type { ExportJobSummary } from "@/types/desktop-api"

type ExportHistoryTone = "success" | "warning" | "info" | "danger" | "neutral"

const statusToneClassNames: Partial<Record<ExportHistoryTone, string>> = {
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  warning:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-300",
  info:
    "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800/60 dark:bg-sky-950/40 dark:text-sky-300",
}

function exportHistoryStatus(job: ExportJobSummary): {
  label: string
  tone: ExportHistoryTone
} {
  if (job.status === "failed") return { label: "导出失败", tone: "danger" }
  if (job.status === "cancelled") return { label: "已取消", tone: "neutral" }
  if (job.status === "queued" || job.status === "running") {
    return { label: "处理中", tone: "info" }
  }
  if (job.artifacts.length === 0) return { label: "未生成产物", tone: "danger" }

  const missingCount = job.artifacts.filter(
    (artifact) => artifact.file_state === "missing",
  ).length
  const modifiedCount = job.artifacts.filter(
    (artifact) => artifact.file_state === "modified",
  ).length

  if (missingCount === job.artifacts.length) {
    return { label: "已删除或移动", tone: "danger" }
  }
  if (missingCount > 0) {
    return { label: "部分文件已删除或移动", tone: "warning" }
  }
  if (modifiedCount > 0) return { label: "文件已修改", tone: "warning" }
  return { label: "可用", tone: "success" }
}

function ExportHistoryStatusBadge({ job }: { job: ExportJobSummary }) {
  const status = exportHistoryStatus(job)

  return (
    <Badge
      aria-label={`导出状态：${status.label}`}
      variant={status.tone === "danger" ? "destructive" : "outline"}
      className={statusToneClassNames[status.tone]}
    >
      {status.label}
    </Badge>
  )
}

export { ExportHistoryStatusBadge }
