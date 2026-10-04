import { FileCheckIcon } from "@/components/ui/file-check-icon"
import { AnimatedActionIcon } from "@/components/animated-action-icon"
import {
  LoaderCircleIcon,
  SaveIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

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

// User-approved: match the section completion mark in both themes.
const savedStateClassName =
  "border-transparent bg-emerald-500 text-white"

function SaveStatusBadge({ state, quiet = false, toolbar = false }: { state: SaveState; quiet?: boolean; toolbar?: boolean }) {
  const label = saveStateLabels[state]
  const isError = state === "error" || state === "conflict"
  const isPending = state === "loading" || state === "saving"
  const content = (
    <span
      key={state}
      data-slot="save-status-content"
      className="inline-flex min-w-0 items-center gap-1 leading-none [&>svg]:size-3 [&>svg]:shrink-0"
    >
      {isPending ? (
        <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
      ) : isError ? (
        <TriangleAlertIcon />
      ) : state === "saved" ? (
        <AnimatedActionIcon icon={FileCheckIcon} size={12} playOnMount />
      ) : (
        <SaveIcon />
      )}
      {label}
    </span>
  )

  if (quiet) {
    return (
      <span
        role="status"
        aria-live="polite"
        aria-label={`保存状态：${label}`}
        className={cn("inline-flex shrink-0 items-center text-xs", isError ? "text-destructive" : "text-muted-foreground")}
      >
        {content}
      </span>
    )
  }

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
      className={cn(state === "saved" && savedStateClassName, toolbar && "h-8 rounded-lg px-2.5 text-sm font-medium")}
    >
      {content}
    </Badge>
  )
}

export { SaveStatusBadge }
