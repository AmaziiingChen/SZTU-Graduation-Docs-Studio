import { GeneralTableGenerator } from "@/components/workbench/general-table-generator"
import { MultiFigureGenerator } from "@/components/workbench/multi-figure-generator"
import { ThreeLineTableGenerator } from "@/components/workbench/three-line-table-generator"
import type { ThesisToolId } from "@/lib/thesis-tools"

export function ThesisToolsWorkbench({ activeTool }: { activeTool: ThesisToolId }) {
  if (activeTool === "three_line_table") return <ThreeLineTableGenerator />
  if (activeTool === "general_table") return <GeneralTableGenerator />
  if (activeTool === "multi_figure") return <MultiFigureGenerator />
  return null
}
