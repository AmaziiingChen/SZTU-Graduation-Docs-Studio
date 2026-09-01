import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import type { ExportJobSummary } from "@/types/desktop-api"
import { ExportHistoryStatusBadge } from "./export-history-status-badge"

afterEach(cleanup)

const completedJob: ExportJobSummary = {
  export_id: "export-fixture",
  request_id: null,
  status: "completed",
  progress: 100,
  error_code: null,
  requested_formats: ["pdf"],
  input_sha256: "fixture",
  template: null,
  snapshot_available: true,
  overwrite_confirmed: false,
  artifacts: [
    {
      artifact_id: "artifact-fixture",
      format: "pdf",
      display_name: "开题报告.pdf",
      sha256: "fixture",
      size_bytes: 1024,
      file_state: "available",
      replaced_existing: false,
      checks: [],
    },
  ],
  created_at: "2026-09-01T00:00:00Z",
  completed_at: "2026-09-01T00:00:01Z",
}

describe("ExportHistoryStatusBadge", () => {
  it("uses green for available artifacts", () => {
    render(<ExportHistoryStatusBadge job={completedJob} />)

    expect(screen.getByLabelText("导出状态：可用")).toHaveClass(
      "border-emerald-200",
      "bg-emerald-50",
      "text-emerald-700",
    )
  })

  it("uses amber for modified artifacts", () => {
    render(
      <ExportHistoryStatusBadge
        job={{
          ...completedJob,
          artifacts: completedJob.artifacts.map((artifact) => ({
            ...artifact,
            file_state: "modified",
          })),
        }}
      />,
    )

    expect(screen.getByLabelText("导出状态：文件已修改")).toHaveClass(
      "border-amber-200",
      "bg-amber-50",
      "text-amber-700",
    )
  })

  it("uses the destructive treatment for missing artifacts", () => {
    render(
      <ExportHistoryStatusBadge
        job={{
          ...completedJob,
          artifacts: completedJob.artifacts.map((artifact) => ({
            ...artifact,
            file_state: "missing",
          })),
        }}
      />,
    )

    expect(screen.getByLabelText("导出状态：已删除或移动")).toHaveClass(
      "bg-destructive/10",
      "text-destructive",
    )
  })
})
