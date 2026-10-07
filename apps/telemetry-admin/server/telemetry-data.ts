import { academicTelemetry } from "../../desktop/electron/academic-telemetry.ts"
import { execFile } from "node:child_process"

import type {
  TelemetryActionPoint,
  TelemetryCountPoint,
  TelemetryDashboardData,
  TelemetryRecentEvent,
  TelemetryRecentPage,
  TelemetryVersionPoint,
} from "../src/types.ts"

const ALLOWED_EVENT_NAMES = new Set([
  "app_started",
  "heartbeat",
  "app_stopped",
  "usage_event",
  "update_event",
])
const ALLOWED_ATTRIBUTE_KEYS = new Set([
  "college",
  "major",
  "launch_mode",
  "uptime_bucket",
  "event_name",
  "view",
  "action",
  "document_type",
  "outcome",
  "error_code",
  "format_count",
  "target_version",
])
const RANGE_DAYS = new Set([7, 30, 90])
const MAX_ROWS = 50_000
const RECENT_PAGE_SIZE = 20
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type RawTelemetryRow = {
  installation_id: string
  session_id: string
  event_name: string
  received_at: string
  occurred_at?: string
  app_version: string
  platform: string
  arch: string
  attributes: Record<string, string | number | boolean>
}

type CliExecutor = (args: string[]) => Promise<string>

type TelemetryCursor = {
  receivedAt: string
  eventId: string
}

type RawTelemetryPageRow = RawTelemetryRow & {
  event_id: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function safeText(value: unknown, maximum = 64): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    ? value
    : null
}

function parseAttributes(value: unknown): Record<string, string | number | boolean> {
  if (!isRecord(value)) return {}
  const attributes: Record<string, string | number | boolean> = {}
  for (const [key, item] of Object.entries(value)) {
    if (!ALLOWED_ATTRIBUTE_KEYS.has(key)) continue
    if (typeof item === "string" && item.length <= (key === "college" || key === "major" ? 200 : 64)) attributes[key] = item
    else if (typeof item === "number" && Number.isFinite(item)) attributes[key] = item
    else if (typeof item === "boolean") attributes[key] = item
  }
  return attributes
}

function parseRow(value: unknown): RawTelemetryRow | null {
  if (!isRecord(value)) return null
  const installationId = safeText(value.installation_id)
  const sessionId = safeText(value.session_id)
  const eventName = safeText(value.event_name)
  const receivedAt = safeText(value.received_at, 80)
  const appVersion = safeText(value.app_version)
  const platform = safeText(value.platform)
  const arch = safeText(value.arch)
  if (
    !installationId ||
    !sessionId ||
    !eventName ||
    !ALLOWED_EVENT_NAMES.has(eventName) ||
    !receivedAt ||
    !Number.isFinite(Date.parse(receivedAt)) ||
    !appVersion ||
    !platform ||
    !arch
  ) {
    return null
  }
  return {
    installation_id: installationId,
    session_id: sessionId,
    event_name: eventName,
    received_at: receivedAt,
    ...(typeof value.occurred_at === "string" && Number.isFinite(Date.parse(value.occurred_at)) ? { occurred_at: value.occurred_at } : {}),
    app_version: appVersion,
    platform,
    arch,
    attributes: parseAttributes(value.attributes),
  }
}

function increment(map: Map<string, number>, key: string, amount = 1): void {
  map.set(key, (map.get(key) ?? 0) + amount)
}

function labelDocumentType(value: string): string {
  return (
    {
      proposal: "开题报告",
      task_book: "任务书",
      midterm: "中期检查",
      advisor_review: "指导教师评审",
      reviewer_review: "评阅教师评审",
      defense_record: "答辩记录",
      grade_assessment: "成绩评定",
    }[value] ?? value
  )
}

function labelAction(value: string): string {
  return (
    {
      check: "内容检查",
      preview: "生成预览",
      template_sync: "模板同步",
      export: "导出",
      qa_record: "验收记录",
    }[value] ?? value
  )
}

function summaryFor(row: RawTelemetryRow): string {
  const attributes = row.attributes
  if (row.event_name === "app_started") {
    return attributes.launch_mode === "packaged" ? "正式构建启动" : "开发构建启动"
  }
  if (row.event_name === "heartbeat" || row.event_name === "app_stopped") {
    return typeof attributes.uptime_bucket === "string"
      ? `运行时长 ${attributes.uptime_bucket}`
      : row.event_name
  }
  if (row.event_name === "update_event") {
    return [attributes.outcome, attributes.target_version].filter(Boolean).join(" · ")
  }
  if (attributes.event_name === "view_opened") {
    return `打开 ${String(attributes.view ?? "未知页面")}`
  }
  if (attributes.event_name === "document_action") {
    return [
      labelDocumentType(String(attributes.document_type ?? "")),
      labelAction(String(attributes.action ?? "")),
      String(attributes.outcome ?? ""),
      attributes.error_code ? `错误码 ${String(attributes.error_code)}` : "",
    ]
      .filter(Boolean)
      .join(" · ")
  }
  return row.event_name
}

function toRecentEvent(row: RawTelemetryRow): TelemetryRecentEvent {
  return {
    receivedAt: row.received_at,
    eventName: row.event_name,
    appVersion: row.app_version,
    platform: row.platform,
    arch: row.arch,
    summary: summaryFor(row),
  }
}

function encodeCursor(cursor: TelemetryCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")
}

function decodeCursor(value: string | null): TelemetryCursor | null {
  if (!value) return null
  if (value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("分页游标无效。")
  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown
  } catch {
    throw new Error("分页游标无效。")
  }
  if (
    !isRecord(decoded) ||
    typeof decoded.receivedAt !== "string" ||
    !Number.isFinite(Date.parse(decoded.receivedAt)) ||
    typeof decoded.eventId !== "string" ||
    !UUID_PATTERN.test(decoded.eventId)
  ) throw new Error("分页游标无效。")
  return { receivedAt: new Date(decoded.receivedAt).toISOString(), eventId: decoded.eventId }
}

function buildRecentPage(rows: RawTelemetryPageRow[]): TelemetryRecentPage {
  const visibleRows = rows.slice(0, RECENT_PAGE_SIZE)
  const last = visibleRows.at(-1)
  return {
    items: visibleRows.map(toRecentEvent),
    nextCursor: rows.length > RECENT_PAGE_SIZE && last
      ? encodeCursor({ receivedAt: last.received_at, eventId: last.event_id })
      : null,
    pageSize: RECENT_PAGE_SIZE,
  }
}

export function aggregateTelemetry(
  rows: RawTelemetryRow[],
  rangeDays: 7 | 30 | 90,
  input: { now?: Date; truncated?: boolean } = {},
): TelemetryDashboardData {
  const installations = new Set<string>()
  const sessions = new Set<string>()
  const daily = new Map<
    string,
    { installations: Set<string>; eventCount: number; launches: number; exports: number }
  >()
  const actionResults = new Map<string, TelemetryActionPoint>()
  const errors = new Map<string, number>()
  const views = new Map<string, number>()
  const uptime = new Map<string, number>()
  const updates = new Map<string, number>()
  const versionRows = new Map<
    string,
    { appVersion: string; platform: string; arch: string; installations: Set<string>; events: number }
  >()
  const academics = new Map<string, { at: number; college: string; major: string }>()
  let launches = 0
  let exportAttempts = 0
  let exportSuccesses = 0
  let errorEvents = 0

  for (const row of rows) {
    const at = Date.parse(row.occurred_at ?? row.received_at)
    if (!academics.has(row.installation_id) || at > academics.get(row.installation_id)!.at) {
      academics.set(row.installation_id, { at, ...academicTelemetry(row.attributes) })
    }
    installations.add(row.installation_id)
    sessions.add(row.session_id)
    const dayKey = new Date(row.received_at).toISOString().slice(0, 10)
    const day = daily.get(dayKey) ?? {
      installations: new Set<string>(),
      eventCount: 0,
      launches: 0,
      exports: 0,
    }
    day.installations.add(row.installation_id)
    day.eventCount += 1
    if (row.event_name === "app_started") {
      launches += 1
      day.launches += 1
    }

    const versionKey = `${row.app_version}|${row.platform}|${row.arch}`
    const version = versionRows.get(versionKey) ?? {
      appVersion: row.app_version,
      platform: row.platform,
      arch: row.arch,
      installations: new Set<string>(),
      events: 0,
    }
    version.installations.add(row.installation_id)
    version.events += 1
    versionRows.set(versionKey, version)

    const attributes = row.attributes
    if (row.event_name === "heartbeat" || row.event_name === "app_stopped") {
      if (typeof attributes.uptime_bucket === "string") {
        increment(uptime, attributes.uptime_bucket)
      }
    } else if (row.event_name === "update_event") {
      if (typeof attributes.outcome === "string") {
        increment(
          updates,
          `${attributes.outcome}|${String(attributes.target_version ?? "")}`,
        )
      }
    } else if (row.event_name === "usage_event") {
      if (attributes.event_name === "view_opened" && typeof attributes.view === "string") {
        increment(views, attributes.view)
      }
      if (
        attributes.event_name === "document_action" &&
        typeof attributes.document_type === "string" &&
        typeof attributes.action === "string" &&
        typeof attributes.outcome === "string"
      ) {
        const key = `${attributes.document_type}|${attributes.action}`
        const current = actionResults.get(key) ?? {
          key,
          documentType: labelDocumentType(attributes.document_type),
          action: labelAction(attributes.action),
          success: 0,
          failure: 0,
          cancelled: 0,
          total: 0,
        }
        if (attributes.outcome === "success") current.success += 1
        else if (attributes.outcome === "failure") current.failure += 1
        else if (attributes.outcome === "cancelled") current.cancelled += 1
        current.total += 1
        actionResults.set(key, current)
        if (attributes.action === "export") {
          exportAttempts += 1
          day.exports += 1
          if (attributes.outcome === "success") exportSuccesses += 1
        }
        if (attributes.outcome === "failure") errorEvents += 1
        if (typeof attributes.error_code === "string") {
          increment(errors, attributes.error_code)
        }
      }
    }
    daily.set(dayKey, day)
  }

  const toCounts = (map: Map<string, number>): TelemetryCountPoint[] =>
    [...map.entries()]
      .map(([key, count]) => ({ key, label: key, count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))

  const recent: TelemetryRecentEvent[] = [...rows]
    .sort((left, right) => Date.parse(right.received_at) - Date.parse(left.received_at))
    .slice(0, 50)
    .map(toRecentEvent)

  const versions: TelemetryVersionPoint[] = [...versionRows.entries()]
    .map(([key, value]) => ({
      key,
      appVersion: value.appVersion,
      platform: value.platform,
      arch: value.arch,
      installations: value.installations.size,
      events: value.events,
    }))
    .sort((left, right) => right.events - left.events || left.key.localeCompare(right.key))

  const academicGroups = new Map<string, { college: string; major: string; installations: number }>()
  for (const entry of academics.values()) {
    const key = `${entry.college}|${entry.major}`
    const group = academicGroups.get(key) ?? { college: entry.college, major: entry.major, installations: 0 }
    group.installations++
    academicGroups.set(key, group)
  }
  return {
    academicDistribution: [...academicGroups.values()].sort((a, b) => b.installations - a.installations || a.college.localeCompare(b.college)),
    generatedAt: (input.now ?? new Date()).toISOString(),
    rangeDays,
    sourceRowCount: rows.length,
    truncated: input.truncated ?? false,
    kpis: {
      activeInstallations: installations.size,
      sessions: sessions.size,
      launches,
      exportAttempts,
      exportSuccessRate:
        exportAttempts === 0 ? null : Math.round((exportSuccesses / exportAttempts) * 10_000) / 100,
      errorEvents,
    },
    daily: [...daily.entries()]
      .map(([day, value]) => ({
        day,
        activeInstallations: value.installations.size,
        eventCount: value.eventCount,
        launches: value.launches,
        exports: value.exports,
      }))
      .sort((left, right) => left.day.localeCompare(right.day)),
    actions: [...actionResults.values()].sort(
      (left, right) => right.total - left.total || left.key.localeCompare(right.key),
    ),
    errors: toCounts(errors),
    views: toCounts(views),
    uptime: toCounts(uptime),
    updates: toCounts(updates).map((item) => {
      const [outcome, version] = item.key.split("|")
      return { ...item, label: version ? `${outcome} · ${version}` : outcome }
    }),
    versions,
    recent,
  }
}

export function parseRangeDays(value: string | null): 7 | 30 | 90 {
  const parsed = Number(value ?? "30")
  return RANGE_DAYS.has(parsed) ? (parsed as 7 | 30 | 90) : 30
}

function executeCloudBaseCli(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "tcb",
      args,
      { encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(new Error("CloudBase CLI 查询失败，请确认已运行 tcb login。"))
          return
        }
        resolve(stdout)
      },
    )
  })
}

function parseCliPayload(stdout: string): unknown {
  const trimmed = stdout.trim()
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    const start = trimmed.indexOf("{")
    const end = trimmed.lastIndexOf("}")
    if (start < 0 || end <= start) throw new Error("CloudBase CLI 未返回 JSON。")
    return JSON.parse(trimmed.slice(start, end + 1)) as unknown
  }
}

function parseCliRows(payload: unknown): RawTelemetryRow[] {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    throw new Error("CloudBase CLI 返回结构无效。")
  }
  const columns = payload.data.Columns
  const encodedRows = payload.data.Rows
  if (!Array.isArray(columns) || !columns.every((column) => typeof column === "string")) {
    throw new Error("CloudBase CLI 返回列信息无效。")
  }
  if (!Array.isArray(encodedRows)) throw new Error("CloudBase CLI 返回行信息无效。")

  return encodedRows
    .map((encodedRow) => {
      let values: unknown
      if (typeof encodedRow === "string") {
        try {
          values = JSON.parse(encodedRow) as unknown
        } catch {
          return null
        }
      } else {
        values = encodedRow
      }
      if (!Array.isArray(values) || values.length !== columns.length) return null
      const record: Record<string, unknown> = {}
      columns.forEach((column, index) => {
        record[column] = values[index]
      })
      if (typeof record.attributes === "string") {
        try {
          record.attributes = JSON.parse(record.attributes) as unknown
        } catch {
          record.attributes = {}
        }
      }
      return parseRow(record)
    })
    .filter((row): row is RawTelemetryRow => row !== null)
}

function parseCliPageRows(payload: unknown): RawTelemetryPageRow[] {
  if (!isRecord(payload) || !isRecord(payload.data)) throw new Error("CloudBase CLI 返回结构无效。")
  const columns = payload.data.Columns
  const encodedRows = payload.data.Rows
  if (!Array.isArray(columns) || !columns.every((column) => typeof column === "string")) {
    throw new Error("CloudBase CLI 返回列信息无效。")
  }
  if (!Array.isArray(encodedRows)) throw new Error("CloudBase CLI 返回行信息无效。")

  return encodedRows.flatMap((encodedRow) => {
    let values: unknown
    try {
      values = typeof encodedRow === "string" ? JSON.parse(encodedRow) as unknown : encodedRow
    } catch {
      return []
    }
    if (!Array.isArray(values) || values.length !== columns.length) return []
    const record: Record<string, unknown> = {}
    columns.forEach((column, index) => { record[column] = values[index] })
    if (typeof record.attributes === "string") {
      try { record.attributes = JSON.parse(record.attributes) as unknown } catch { record.attributes = {} }
    }
    const row = parseRow(record)
    if (!row || typeof record.event_id !== "string" || !UUID_PATTERN.test(record.event_id)) return []
    return [{ ...row, event_id: record.event_id }]
  })
}

export async function fetchRecentTelemetryPageFromCli(input: {
  envId: string
  rangeDays: 7 | 30 | 90
  cursor?: string | null
  execute?: CliExecutor
}): Promise<TelemetryRecentPage> {
  if (!/^[-a-z0-9]{6,64}$/i.test(input.envId)) throw new Error("环境 ID 格式无效。")
  const cursor = decodeCursor(input.cursor ?? null)
  const cursorFilter = cursor
    ? ` AND (received_at, event_id) < ('${cursor.receivedAt}'::timestamptz, '${cursor.eventId}'::uuid)`
    : ""
  const sql = `SELECT event_id::text AS event_id, installation_id::text AS installation_id, session_id::text AS session_id, event_name, to_char(received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS received_at, to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS occurred_at, app_version, platform, arch, attributes FROM public.telemetry_events WHERE received_at >= NOW() - make_interval(days => ${input.rangeDays})${cursorFilter} ORDER BY received_at DESC, event_id DESC LIMIT ${RECENT_PAGE_SIZE + 1}`
  const stdout = await (input.execute ?? executeCloudBaseCli)([
    "db", "execute", "-e", input.envId, "--sql", sql, "--json",
  ])
  const rows = parseCliPageRows(parseCliPayload(stdout))
  return buildRecentPage(rows)
}

export function fixtureRecentTelemetryPage(
  cursorValue: string | null,
  now = new Date(),
): TelemetryRecentPage {
  const cursor = decodeCursor(cursorValue)
  const rows: RawTelemetryPageRow[] = Array.from({ length: 45 }, (_, index) => {
    const attributes: Record<string, string | number | boolean> = index % 3 === 0
      ? { uptime_bucket: "5_to_30m" }
      : { event_name: "view_opened", view: "proposal" }
    return {
      event_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      installation_id: "00000000-0000-4000-8000-000000000001",
      session_id: "00000000-0000-4000-8000-000000000002",
      event_name: index % 3 === 0 ? "heartbeat" : "usage_event",
      received_at: new Date(now.getTime() - index * 60_000).toISOString(),
      app_version: "0.1.0",
      platform: index % 2 === 0 ? "darwin" : "win32",
      arch: index % 2 === 0 ? "arm64" : "x64",
      attributes,
    }
  })
  const filtered = cursor
    ? rows.filter((row) => (
        Date.parse(row.received_at) < Date.parse(cursor.receivedAt) ||
        (row.received_at === cursor.receivedAt && row.event_id < cursor.eventId)
      ))
    : rows
  return buildRecentPage(filtered.slice(0, RECENT_PAGE_SIZE + 1))
}

export async function fetchTelemetryRowsFromCli(input: {
  envId: string
  rangeDays: 7 | 30 | 90
  execute?: CliExecutor
}): Promise<{ rows: RawTelemetryRow[]; truncated: boolean }> {
  if (!/^[-a-z0-9]{6,64}$/i.test(input.envId)) throw new Error("环境 ID 格式无效。")
  const sql = `SELECT installation_id::text AS installation_id, session_id::text AS session_id, event_name, to_char(received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS received_at, to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS occurred_at, app_version, platform, arch, attributes FROM public.telemetry_events WHERE received_at >= NOW() - make_interval(days => ${input.rangeDays}) ORDER BY received_at ASC LIMIT ${MAX_ROWS + 1}`
  const execute = input.execute ?? executeCloudBaseCli
  const stdout = await execute([
    "db",
    "execute",
    "-e",
    input.envId,
    "--sql",
    sql,
    "--json",
  ])
  const rows = parseCliRows(parseCliPayload(stdout))
  return {
    rows: rows.slice(0, MAX_ROWS),
    truncated: rows.length > MAX_ROWS,
  }
}

export function fixtureTelemetryRows(now = new Date()): RawTelemetryRow[] {
  const timestamp = now.toISOString()
  return [
    {
      installation_id: "00000000-0000-4000-8000-000000000001",
      session_id: "00000000-0000-4000-8000-000000000002",
      event_name: "app_started",
      received_at: timestamp,
      app_version: "0.1.0",
      platform: "darwin",
      arch: "arm64",
      attributes: { launch_mode: "development", college: "音乐学院", major: "音乐表演" },
    },
  ]
}
