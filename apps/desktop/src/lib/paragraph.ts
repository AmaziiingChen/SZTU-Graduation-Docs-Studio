import type { ParagraphInput } from "@/types/structured-content"

export function paragraphInputText(value: ParagraphInput): string {
  if (typeof value === "string") return value
  return value.runs.map((run) => "text" in run ? run.text : run.alt).join("")
}
