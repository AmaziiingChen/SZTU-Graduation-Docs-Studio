import {
  LoaderCircleIcon,
  SaveIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"

export type SaveState =
  | "loading"
  | "dirty"
  | "saving"
  | "saved"
  | "error"
  | "conflict"

const saveStateLabels: Record<SaveState, string> = {
  loading: "正在载入",
  dirty: "未保存",
  saving: "正在保存",
  saved: "已保存",
  error: "保存失败",
  conflict: "修订冲突",
}

// The saved state is the only approved non-shadcn palette exception in the workbench.
// Keep the complete light/dark treatment here so other business views do not fork it.
const savedStateClassName =
  "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300"

function SaveStatusBadge({ state }: { state: SaveState }) {
  const label = saveStateLabels[state]
  const isError = state === "error" || state === "conflict"
  const isPending = state === "loading" || state === "saving"

  return (
    <Badge
      aria-label={`保存状态：${label}`}
      variant={
        isError
          ? "destructive"
          : state === "dirty" || isPending || state === "saved"
            ? "outline"
            : "secondary"
      }
      className={state === "saved" ? savedStateClassName : undefined}
    >
      {isPending ? (
        <LoaderCircleIcon className="animate-spin" />
      ) : isError ? (
        <TriangleAlertIcon />
      ) : (
        <SaveIcon />
      )}
      {label}
    </Badge>
  )
}

export { SaveStatusBadge }
