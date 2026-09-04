import { useCallback } from "react"

import { GeneralTableGenerator } from "@/components/workbench/general-table-generator"
import { MultiFigureGenerator } from "@/components/workbench/multi-figure-generator"
import type { SaveState } from "@/components/workbench/save-status-badge"
import { ThreeLineTableGenerator } from "@/components/workbench/three-line-table-generator"
import type { ThesisToolId } from "@/lib/thesis-tools"

export function ThesisToolsWorkbench({
  activeTool,
  onSaveStateChange,
}: {
  activeTool: ThesisToolId
  onSaveStateChange?: (toolId: ThesisToolId, state: SaveState) => void
}) {
  const reportSaveState = useCallback(
    (state: SaveState) => onSaveStateChange?.(activeTool, state),
    [activeTool, onSaveStateChange],
  )

  if (activeTool === "three_line_table") {
    return <ThreeLineTableGenerator onSaveStateChange={reportSaveState} />
  }
  if (activeTool === "general_table") {
    return <GeneralTableGenerator onSaveStateChange={reportSaveState} />
  }
  if (activeTool === "multi_figure") {
    return <MultiFigureGenerator onSaveStateChange={reportSaveState} />
  }
  return null
}
