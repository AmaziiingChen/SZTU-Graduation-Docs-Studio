export const THESIS_TOOL_IDS = ["three_line_table", "general_table", "multi_figure"] as const

export type ThesisToolId = (typeof THESIS_TOOL_IDS)[number]

export const thesisToolOptions: Array<{
  id: ThesisToolId
  label: string
  navigationLabel: string
  description: string
}> = [
  {
    id: "three_line_table",
    label: "三线表生成器",
    navigationLabel: "三线表生成器",
    description: "粘贴表格数据并生成 LaTeX",
  },
  {
    id: "general_table",
    label: "表格生成器",
    navigationLabel: "表格生成器",
    description: "生成普通、通栏或跨页表格",
  },
  {
    id: "multi_figure",
    label: "多图排版",
    navigationLabel: "多图排版",
    description: "组合本机图片并生成 LaTeX",
  },
]
