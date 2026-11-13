import { describe, expect, it, vi } from "vitest"

import {
  buildDiagnosticDashboard,
  fetchDiagnosticRowsFromCli,
  fixtureDiagnosticRows,
  parseDiagnosticRangeDays,
} from "./diagnostic-data.ts"

describe("diagnostic dashboard data", () => {
  it("builds a safe report summary with environment and operation details", () => {
    const now = new Date("2026-09-04T01:00:00.000Z")
    const data = buildDiagnosticDashboard(fixtureDiagnosticRows(now), 30, now)

    expect(data.kpis).toEqual({
      reports: 1,
      readyReports: 1,
      failedOperations: 1,
      expiringSoon: 0,
    })
    expect(data.reports[0]).toEqual(
      expect.objectContaining({
        reportId: "01144ee9-9685-44de-877c-982aaa2cef3d",
        operationCount: 2,
        failedOperationCount: 1,
      }),
    )
    expect(data.reports[0]?.environment.checks).toHaveLength(21)
    expect(data.reports[0]?.environment.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "process_tex_packages" }),
      expect.objectContaining({ id: "task_book_docx_font" }),
    ]))
    expect(data.reports[0]?.operationSummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "生成预览", failure: 1 }),
        expect.objectContaining({ label: "保存文档草稿", success: 1 }),
      ]),
    )
    expect(JSON.stringify(data)).not.toContain("blocked_findings")
  })

  it("shows the failing tool, stage and exit code from a version 3 report", () => {
    const now = new Date("2026-09-04T01:00:00.000Z")
    const rows = fixtureDiagnosticRows(now)
    const report = rows[0]!.report as { operations: unknown[] }
    report.operations.push({
      occurred_at: now.toISOString(), operation: "diagnostic.step", outcome: "failure",
      duration_bucket: "under_100ms", duration_ms: 12, error_code: "RENDER_FAILED",
      context: {
        stage: "preview_rasterize", tool: "pdftoppm", tool_source: "system",
        tool_version: "26.1.0", exit_code: 23, reason: "tool_nonzero",
        document_type: "task_book",
      },
    })
    const details = buildDiagnosticDashboard(rows, 30, now).reports[0]?.recentOperations
    expect(details).toEqual(expect.arrayContaining([
      expect.objectContaining({ context: expect.objectContaining({
        stage: "preview_rasterize", tool: "pdftoppm", tool_version: "26.1.0", exit_code: 23, reason: "tool_nonzero",
      }) }),
    ]))
  })

  it("defaults unsupported date ranges to 30 days", () => {
    expect(parseDiagnosticRangeDays("7")).toBe(7)
    expect(parseDiagnosticRangeDays("90")).toBe(30)
  })

  it("uses a fixed read-only query and parses CLI rows", async () => {
    const row = fixtureDiagnosticRows(new Date("2026-09-04T01:00:00.000Z"))[0]
    const execute = vi.fn().mockResolvedValue(JSON.stringify({
      data: {
        Columns: ["report_id", "created_at", "received_at", "expires_at", "report"],
        Rows: [JSON.stringify([
          row?.report_id,
          row?.created_at,
          row?.received_at,
          row?.expires_at,
          row?.report,
        ])],
      },
    }))

    const rows = await fetchDiagnosticRowsFromCli({
      envId: "amazingapp-d5giro9ac73398410",
      rangeDays: 30,
      execute,
    })

    expect(rows).toHaveLength(1)
    const args = execute.mock.calls[0]?.[0] as string[]
    expect(args.slice(0, 4)).toEqual([
      "db", "execute", "-e", "amazingapp-d5giro9ac73398410",
    ])
    expect(args[args.indexOf("--sql") + 1]).toContain("FROM public.diagnostic_reports")
    expect(args[args.indexOf("--sql") + 1]).toContain("LIMIT 250")
    expect(args[args.indexOf("--sql") + 1]).not.toMatch(/DELETE|UPDATE|INSERT/)
  })
})
