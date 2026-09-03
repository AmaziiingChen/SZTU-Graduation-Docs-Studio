import { describe, expect, it, vi } from "vitest"

import {
  aggregateTelemetry,
  fetchRecentTelemetryPageFromCli,
  fetchTelemetryRowsFromCli,
  parseRangeDays,
  type RawTelemetryRow,
} from "./telemetry-data.ts"

const rows: RawTelemetryRow[] = [
  {
    installation_id: "00000000-0000-4000-8000-000000000001",
    session_id: "00000000-0000-4000-8000-000000000011",
    event_name: "app_started",
    received_at: "2026-08-30T01:00:00.000Z",
    app_version: "0.1.0",
    platform: "darwin",
    arch: "arm64",
    attributes: { launch_mode: "development" },
  },
  {
    installation_id: "00000000-0000-4000-8000-000000000001",
    session_id: "00000000-0000-4000-8000-000000000011",
    event_name: "usage_event",
    received_at: "2026-08-30T01:05:00.000Z",
    app_version: "0.1.0",
    platform: "darwin",
    arch: "arm64",
    attributes: {
      event_name: "document_action",
      document_type: "proposal",
      action: "export",
      outcome: "success",
      format_count: 2,
    },
  },
  {
    installation_id: "00000000-0000-4000-8000-000000000002",
    session_id: "00000000-0000-4000-8000-000000000012",
    event_name: "usage_event",
    received_at: "2026-08-31T02:00:00.000Z",
    app_version: "0.1.1",
    platform: "win32",
    arch: "x64",
    attributes: {
      event_name: "document_action",
      document_type: "midterm",
      action: "export",
      outcome: "failure",
      error_code: "RENDER_FAILED",
    },
  },
]

describe("telemetry dashboard aggregation", () => {
  it("aggregates reach, sessions, actions and errors without exposing identifiers", () => {
    const result = aggregateTelemetry([...rows], 30, {
      now: new Date("2026-08-31T03:00:00.000Z"),
    })

    expect(result.kpis).toEqual({
      activeInstallations: 2,
      sessions: 2,
      launches: 1,
      exportAttempts: 2,
      exportSuccessRate: 50,
      errorEvents: 1,
    })
    expect(result.daily).toHaveLength(2)
    expect(result.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "导出", total: 1, success: 1 }),
        expect.objectContaining({ action: "导出", total: 1, failure: 1 }),
      ]),
    )
    expect(result.errors).toEqual([
      { key: "RENDER_FAILED", label: "RENDER_FAILED", count: 1 },
    ])
    expect(JSON.stringify(result)).not.toContain("00000000-0000")
  })

  it("defaults unsupported date ranges to 30 days", () => {
    expect(parseRangeDays("7")).toBe(7)
    expect(parseRangeDays("90")).toBe(90)
    expect(parseRangeDays("365")).toBe(30)
  })

  it("reads fixed CLI query results and never returns raw identifiers in aggregates", async () => {
    const execute = vi.fn().mockResolvedValue(
      JSON.stringify({
        data: {
          Columns: [
            "installation_id",
            "session_id",
            "event_name",
            "received_at",
            "app_version",
            "platform",
            "arch",
            "attributes",
          ],
          Rows: [
            JSON.stringify([
              rows[0].installation_id,
              rows[0].session_id,
              rows[0].event_name,
              rows[0].received_at,
              rows[0].app_version,
              rows[0].platform,
              rows[0].arch,
              {
                launch_mode: "development",
                forbidden_free_text: "student content",
              },
            ]),
          ],
        },
      }),
    )

    const result = await fetchTelemetryRowsFromCli({
      envId: "amazingapp-d5giro9ac73398410",
      rangeDays: 30,
      execute,
    })
    const aggregate = aggregateTelemetry(result.rows, 30)

    expect(aggregate.recent[0]?.summary).toBe("开发构建启动")
    expect(JSON.stringify(aggregate)).not.toContain("student content")
    expect(execute).toHaveBeenCalledOnce()
    const args = execute.mock.calls[0]?.[0] as string[]
    expect(args.slice(0, 4)).toEqual([
      "db",
      "execute",
      "-e",
      "amazingapp-d5giro9ac73398410",
    ])
    expect(args[args.indexOf("--sql") + 1]).toContain("make_interval(days => 30)")
    expect(args).not.toContain("server-only-test-key")
  })

  it("paginates recent events with an opaque stable cursor", async () => {
    const pageRows = Array.from({ length: 21 }, (_, index) => [
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      rows[0].installation_id,
      rows[0].session_id,
      rows[0].event_name,
      new Date(Date.parse("2026-08-31T03:00:00.000Z") - index * 1000).toISOString(),
      rows[0].app_version,
      rows[0].platform,
      rows[0].arch,
      rows[0].attributes,
    ])
    const execute = vi.fn().mockResolvedValue(JSON.stringify({
      data: {
        Columns: [
          "event_id", "installation_id", "session_id", "event_name", "received_at",
          "app_version", "platform", "arch", "attributes",
        ],
        Rows: pageRows.map((row) => JSON.stringify(row)),
      },
    }))

    const first = await fetchRecentTelemetryPageFromCli({
      envId: "amazingapp-d5giro9ac73398410",
      rangeDays: 30,
      execute,
    })

    expect(first.items).toHaveLength(20)
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(JSON.stringify(first)).not.toContain(rows[0].installation_id)
    const firstSql = execute.mock.calls[0]?.[0][execute.mock.calls[0]?.[0].indexOf("--sql") + 1] as string
    expect(firstSql).toContain("ORDER BY received_at DESC, event_id DESC LIMIT 21")

    await fetchRecentTelemetryPageFromCli({
      envId: "amazingapp-d5giro9ac73398410",
      rangeDays: 30,
      cursor: first.nextCursor,
      execute,
    })
    const secondArgs = execute.mock.calls[1]?.[0] as string[]
    expect(secondArgs[secondArgs.indexOf("--sql") + 1]).toContain("(received_at, event_id) <")
  })
})
