import { execFile } from "node:child_process"

import type {
  DiagnosticDashboardData,
  DiagnosticEnvironmentCheck,
  DiagnosticOperation,
  DiagnosticOperationSummary,
  DiagnosticOutcome,
  DiagnosticReportItem,
  DiagnosticStatus,
} from "../src/types.ts"

const RANGE_DAYS = new Set([7, 30])
const MAX_REPORTS = 250
const REPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SAFE_TEXT = /^[0-9A-Za-z][0-9A-Za-z._()+ -]{0,95}$/
const STABLE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/
const CHECK_STATUSES = new Set<DiagnosticStatus>(["pass", "warn", "fail"])
const OUTCOMES = new Set<DiagnosticOutcome>(["success", "failure", "cancelled"])
const DURATION_BUCKETS = new Set([
  "under_100ms",
  "100ms_to_1s",
  "1s_to_5s",
  "5s_to_30s",
  "over_30s",
])

const CHECK_LABELS: Record<string, string> = {
  python: "应用运行组件",
  temporary_directory: "本机临时目录",
  document_dependencies: "文档生成组件",
  xelatex: "XeLaTeX",
  pdf_tools: "PDF 工具",
  office_editor: "Word/WPS",
  template_pack: "受信任模板",
  proposal_engine: "开题报告模板",
  task_book_engine: "任务书模板",
  midterm_engine: "中期检查模板",
}

const OPERATION_LABELS: Record<string, string> = {
  "app.lifecycle": "应用启动",
  "renderer.process": "渲染进程",
  "system.ping": "运行组件连接",
  "system.version": "运行组件版本",
  "environment.check": "环境检查",
  "workspace.open": "打开工作区",
  "workspace.saveProfileDraft": "保存档案草稿",
  "workspace.saveProfile": "保存学生档案",
  "workspace.createDocument": "新建文档",
  "workspace.selectDocument": "切换文档",
  "workspace.saveDraft": "保存文档草稿",
  "workspace.closeTemporary": "关闭临时文档",
  "document.check": "检查内容",
  "preview.generate": "生成预览",
  "export.preflight": "导出预检",
  "export.run": "导出文件",
  "export.history": "读取导出历史",
  "export.deleteHistory": "删除导出历史",
  "export.resolveArtifact": "定位导出文件",
  "template.install": "安装模板",
  "qa.record": "记录验收",
  "diagnostic.prepare": "生成诊断包",
  "diagnostic.save": "保存诊断包",
  "diagnostic.send": "发送诊断包",
  "telemetry.service": "遥测服务",
  "update.service": "更新服务",
}

const DURATION_LABELS: Record<string, string> = {
  under_100ms: "少于 0.1 秒",
  "100ms_to_1s": "0.1–1 秒",
  "1s_to_5s": "1–5 秒",
  "5s_to_30s": "5–30 秒",
  over_30s: "超过 30 秒",
}

type CliExecutor = (args: string[]) => Promise<string>

export type RawDiagnosticRow = {
  report_id: string
  created_at: string
  received_at: string
  expires_at: string
  report: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function safeText(value: unknown, maximum = 96): string | null {
  return typeof value === "string" && value.length <= maximum && SAFE_TEXT.test(value)
    ? value
    : null
}

function safeDate(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null
}

function parseEnvironmentChecks(value: unknown): DiagnosticEnvironmentCheck[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || !(item.id in CHECK_LABELS)) return []
    if (typeof item.required !== "boolean" || !CHECK_STATUSES.has(item.status as DiagnosticStatus)) {
      return []
    }
    return [{
      id: item.id,
      label: CHECK_LABELS[item.id] ?? item.id,
      required: item.required,
      status: item.status as DiagnosticStatus,
    }]
  })
}

function parseOperations(value: unknown): DiagnosticOperation[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item)) return []
    const occurredAt = safeDate(item.occurred_at)
    const operation = typeof item.operation === "string" ? item.operation : ""
    const outcome = item.outcome as DiagnosticOutcome
    const durationBucket = typeof item.duration_bucket === "string" ? item.duration_bucket : ""
    if (
      !occurredAt ||
      !(operation in OPERATION_LABELS) ||
      !OUTCOMES.has(outcome) ||
      !DURATION_BUCKETS.has(durationBucket)
    ) return []
    const errorCode =
      typeof item.error_code === "string" && STABLE_CODE.test(item.error_code)
        ? item.error_code
        : null
    return [{
      occurredAt,
      operation,
      label: OPERATION_LABELS[operation] ?? operation,
      outcome,
      durationBucket,
      durationLabel: DURATION_LABELS[durationBucket] ?? durationBucket,
      errorCode,
    }]
  })
}

function summarizeOperations(operations: DiagnosticOperation[]): DiagnosticOperationSummary[] {
  const summaries = new Map<string, DiagnosticOperationSummary>()
  for (const item of operations) {
    const summary = summaries.get(item.operation) ?? {
      operation: item.operation,
      label: item.label,
      success: 0,
      failure: 0,
      cancelled: 0,
      total: 0,
    }
    summary[item.outcome] += 1
    summary.total += 1
    summaries.set(item.operation, summary)
  }
  return [...summaries.values()].sort(
    (left, right) => right.total - left.total || left.label.localeCompare(right.label, "zh-CN"),
  )
}

function parseReport(row: RawDiagnosticRow): DiagnosticReportItem | null {
  if (!REPORT_ID.test(row.report_id) || !isRecord(row.report)) return null
  const createdAt = safeDate(row.created_at)
  const receivedAt = safeDate(row.received_at)
  const expiresAt = safeDate(row.expires_at)
  const application = row.report.application
  const device = row.report.device
  const environment = row.report.environment
  const services = row.report.services
  const privacy = row.report.privacy
  if (
    !createdAt || !receivedAt || !expiresAt ||
    !isRecord(application) || !isRecord(device) || !isRecord(environment) ||
    !isRecord(services) || !isRecord(privacy)
  ) return null

  const version = safeText(application.version, 64)
  const electronVersion = safeText(application.electron_version, 64)
  const platform = safeText(device.platform, 16)
  const architecture = safeText(device.architecture, 16)
  const osRelease = safeText(device.os_release)
  const cpuCountBucket = safeText(device.cpu_count_bucket, 32)
  const memoryBucket = safeText(device.memory_bucket, 32)
  const pythonVersion = safeText(environment.python_version, 64)
  if (
    !version || !electronVersion || typeof application.packaged !== "boolean" ||
    !platform || !architecture || !osRelease || !cpuCountBucket || !memoryBucket ||
    typeof environment.ready !== "boolean" || !pythonVersion ||
    typeof services.telemetry_configured !== "boolean" ||
    typeof services.update_configured !== "boolean" ||
    privacy.scan_status !== "passed" ||
    !Number.isInteger(privacy.source_fields_removed)
  ) return null

  const checks = parseEnvironmentChecks(environment.checks)
  const operations = parseOperations(row.report.operations)
  return {
    reportId: row.report_id,
    createdAt,
    receivedAt,
    expiresAt,
    application: { version, electronVersion, packaged: application.packaged },
    device: {
      platform,
      platformLabel: ({ darwin: "macOS", win32: "Windows", linux: "Linux" })[platform] ?? platform,
      architecture,
      osRelease,
      cpuCountBucket,
      cpuCountLabel: ({
        "1_to_2": "1–2 核", "3_to_4": "3–4 核", "5_to_8": "5–8 核",
        "9_to_16": "9–16 核", over_16: "16 核以上",
      })[cpuCountBucket] ?? cpuCountBucket,
      memoryBucket,
      memoryLabel: ({
        under_4gb: "4 GB 以下", "4_to_8gb": "4–8 GB", "8_to_16gb": "8–16 GB",
        "16_to_32gb": "16–32 GB", over_32gb: "32 GB 以上",
      })[memoryBucket] ?? memoryBucket,
    },
    environment: {
      ready: environment.ready,
      pythonVersion,
      checks,
      passCount: checks.filter((check) => check.status === "pass").length,
      warnCount: checks.filter((check) => check.status === "warn").length,
      failCount: checks.filter((check) => check.status === "fail").length,
    },
    services: {
      telemetryConfigured: services.telemetry_configured,
      updateConfigured: services.update_configured,
    },
    privacy: { sourceFieldsRemoved: Number(privacy.source_fields_removed) },
    operationCount: operations.length,
    failedOperationCount: operations.filter((item) => item.outcome === "failure").length,
    operationSummary: summarizeOperations(operations),
    recentOperations: [...operations]
      .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
      .slice(0, 30),
  }
}

export function buildDiagnosticDashboard(
  rows: RawDiagnosticRow[],
  rangeDays: 7 | 30,
  now = new Date(),
): DiagnosticDashboardData {
  const reports = rows
    .map(parseReport)
    .filter((report): report is DiagnosticReportItem => report !== null)
    .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt))
  const sevenDaysFromNow = now.getTime() + 7 * 24 * 60 * 60 * 1000
  return {
    generatedAt: now.toISOString(),
    rangeDays,
    kpis: {
      reports: reports.length,
      readyReports: reports.filter((report) => report.environment.ready).length,
      failedOperations: reports.reduce((sum, report) => sum + report.failedOperationCount, 0),
      expiringSoon: reports.filter((report) => Date.parse(report.expiresAt) <= sevenDaysFromNow).length,
    },
    reports,
  }
}

export function parseDiagnosticRangeDays(value: string | null): 7 | 30 {
  const parsed = Number(value ?? "30")
  return RANGE_DAYS.has(parsed) ? (parsed as 7 | 30) : 30
}

function executeCloudBaseCli(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "tcb",
      args,
      { encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(new Error("CloudBase CLI 查询失败，请确认已经登录。"))
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

function parseCliRows(payload: unknown): RawDiagnosticRow[] {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    throw new Error("CloudBase CLI 返回结构无效。")
  }
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
    if (typeof record.report === "string") {
      try { record.report = JSON.parse(record.report) as unknown } catch { return [] }
    }
    if (
      typeof record.report_id !== "string" || typeof record.created_at !== "string" ||
      typeof record.received_at !== "string" || typeof record.expires_at !== "string"
    ) return []
    return [{
      report_id: record.report_id,
      created_at: record.created_at,
      received_at: record.received_at,
      expires_at: record.expires_at,
      report: record.report,
    }]
  })
}

export async function fetchDiagnosticRowsFromCli(input: {
  envId: string
  rangeDays: 7 | 30
  execute?: CliExecutor
}): Promise<RawDiagnosticRow[]> {
  if (!/^[-a-z0-9]{6,64}$/i.test(input.envId)) throw new Error("环境 ID 格式无效。")
  const sql = `SELECT report_id::text AS report_id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at, to_char(received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS received_at, to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at, report FROM public.diagnostic_reports WHERE received_at >= NOW() - make_interval(days => ${input.rangeDays}) ORDER BY received_at DESC LIMIT ${MAX_REPORTS}`
  const stdout = await (input.execute ?? executeCloudBaseCli)([
    "db", "execute", "-e", input.envId, "--sql", sql, "--json",
  ])
  return parseCliRows(parseCliPayload(stdout))
}

export function fixtureDiagnosticRows(now = new Date()): RawDiagnosticRow[] {
  const createdAt = new Date(now.getTime() - 3 * 60 * 1000).toISOString()
  return [{
    report_id: "01144ee9-9685-44de-877c-982aaa2cef3d",
    created_at: createdAt,
    received_at: new Date(now.getTime() - 2 * 60 * 1000).toISOString(),
    expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    report: {
      application: { version: "0.1.0", electron_version: "44.0.0", packaged: false },
      device: {
        platform: "darwin", architecture: "arm64", os_release: "25.6.0",
        cpu_count_bucket: "9_to_16", memory_bucket: "16_to_32gb",
      },
      environment: {
        ready: true, python_version: "3.13.7",
        checks: Object.keys(CHECK_LABELS).map((id) => ({ id, required: true, status: "pass" })),
      },
      services: { telemetry_configured: true, update_configured: true },
      operations: [
        { occurred_at: createdAt, operation: "workspace.saveDraft", outcome: "success", duration_bucket: "under_100ms" },
        { occurred_at: createdAt, operation: "preview.generate", outcome: "failure", duration_bucket: "5s_to_30s", error_code: "RENDER_FAILED" },
      ],
      privacy: { scan_status: "passed", source_fields_removed: 2, blocked_findings: 0 },
    },
  }]
}
