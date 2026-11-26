import { randomUUID } from "node:crypto"
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { diagnosticContext, validDiagnosticContext, type DiagnosticContext } from "./diagnostic-context.js"

const MAX_OPERATION_ENTRIES = 200
const MAX_PERSISTED_BYTES = 128 * 1024
const MAX_REPORT_BYTES = 256 * 1024
const REPORT_LIFETIME_MS = 10 * 60 * 1000
const STABLE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/
const SAFE_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/
const SAFE_RELEASE = /^[0-9A-Za-z][0-9A-Za-z._()+ -]{0,95}$/
const SAFE_CHECK_ID = /^[a-z][a-z0-9_]{0,63}$/

export const DIAGNOSTIC_OPERATIONS = [
  "app.lifecycle",
  "renderer.process",
  "system.ping",
  "system.version",
  "environment.check",
  "workspace.open",
  "workspace.listDocuments",
  "workspace.installDemoDocuments",
  "workspace.removeDemoDocuments",
  "workspace.renameDocument",
  "workspace.deleteDocument",
  "workspace.restoreDocument",
  "workspace.purgeDocument",
  "workspace.saveProfileDraft",
  "workspace.saveProfile", "workspace.createProfile", "workspace.selectProfile",
  "workspace.deleteProfile", "workspace.restoreProfile",
  "workspace.createDocument",
  "workspace.selectDocument",
  "workspace.saveDraft",
  "workspace.closeTemporary",
  "document.check",
  "preview.generate",
  "export.preflight",
  "export.run",
  "export.history",
  "export.deleteHistory",
  "export.resolveArtifact",
  "template.install",
  "qa.record",
  "diagnostic.step",
  "diagnostic.prepare",
  "diagnostic.save",
  "diagnostic.send",
  "telemetry.service",
  "update.service",
] as const

export type DiagnosticOperation = (typeof DIAGNOSTIC_OPERATIONS)[number]
export type DiagnosticOutcome = "success" | "failure" | "cancelled"
export type DurationBucket =
  | "under_100ms"
  | "100ms_to_1s"
  | "1s_to_5s"
  | "5s_to_30s"
  | "over_30s"

export type DiagnosticOperationEntry = {
  occurred_at: string
  operation: DiagnosticOperation
  outcome: DiagnosticOutcome
  duration_bucket: DurationBucket
  error_code?: string
  duration_ms?: number
  context?: DiagnosticContext
}

type EnvironmentCheckInput = {
  id: string
  required: boolean
  status: "pass" | "warn" | "fail"
  message?: string
  details?: Record<string, unknown>
}

export type DiagnosticEnvironmentInput = {
  ready: boolean
  platform: {
    system: string
    release: string
    machine: string
    python: string
  }
  checks: EnvironmentCheckInput[]
}

export type DiagnosticReport = {
  schema_version: "3.0"
  report_id: string
  created_at: string
  application: {
    version: string
    electron_version: string
    packaged: boolean
  }
  device: {
    platform: "darwin" | "win32" | "linux"
    architecture: "arm64" | "x64"
    os_release: string
    cpu_count_bucket: "1_to_2" | "3_to_4" | "5_to_8" | "9_to_16" | "over_16"
    memory_bucket: "under_4gb" | "4_to_8gb" | "8_to_16gb" | "16_to_32gb" | "over_32gb"
  }
  environment: {
    ready: boolean
    python_version: string
    checks: Array<{
      id: string
      required: boolean
      status: "pass" | "warn" | "fail"
    }>
  }
  services: {
    telemetry_configured: boolean
    update_configured: boolean
  }
  operations: DiagnosticOperationEntry[]
  privacy: {
    scan_status: "passed"
    source_fields_removed: number
    blocked_findings: 0
  }
}

export type DiagnosticSummary = {
  reportId: string
  createdAt: string
  sizeBytes: number
  operationCount: number
  environmentCheckCount: number
  sourceFieldsRemoved: number
  privacyStatus: "passed"
}

export type DiagnosticSendResult = {
  sent: true
  reportId: string
  retentionDays: number
}

type PreparedReport = {
  report: DiagnosticReport
  serialized: string
  expiresAt: number
}

const KNOWN_ENVIRONMENT_CHECKS = new Set([
  "python",
  "temporary_directory",
  "document_dependencies",
  "xelatex",
  "pdf_tools",
  "process_tex_packages",
  "thesis_toolchain",
  "thesis_tex_packages",
  "core_document_fonts",
  "special_document_fonts",
  "task_book_docx_font",
  "office_editor",
  "template_pack",
  "thesis_template",
  "proposal_engine",
  "midterm_engine",
  "task_book_engine",
  "advisor_review_engine",
  "reviewer_review_engine",
  "defense_record_engine",
  "grade_assessment_engine",
])
const OPERATIONS = new Set<string>(DIAGNOSTIC_OPERATIONS)
const OUTCOMES = new Set<DiagnosticOutcome>(["success", "failure", "cancelled"])
const DURATIONS = new Set<DurationBucket>([
  "under_100ms",
  "100ms_to_1s",
  "1s_to_5s",
  "5s_to_30s",
  "over_30s",
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional])
  return (
    required.every((key) => key in value) &&
    Object.keys(value).every((key) => allowed.has(key))
  )
}

function durationBucket(milliseconds: number): DurationBucket {
  if (milliseconds < 100) return "under_100ms"
  if (milliseconds < 1_000) return "100ms_to_1s"
  if (milliseconds < 5_000) return "1s_to_5s"
  if (milliseconds < 30_000) return "5s_to_30s"
  return "over_30s"
}

function cpuCountBucket(count: number): DiagnosticReport["device"]["cpu_count_bucket"] {
  if (count <= 2) return "1_to_2"
  if (count <= 4) return "3_to_4"
  if (count <= 8) return "5_to_8"
  if (count <= 16) return "9_to_16"
  return "over_16"
}

function memoryBucket(bytes: number): DiagnosticReport["device"]["memory_bucket"] {
  const gigabytes = bytes / 1024 ** 3
  if (gigabytes < 4) return "under_4gb"
  if (gigabytes < 8) return "4_to_8gb"
  if (gigabytes < 16) return "8_to_16gb"
  if (gigabytes < 32) return "16_to_32gb"
  return "over_32gb"
}

function safeVersion(value: string): string {
  const normalized = value.trim()
  return SAFE_VERSION.test(normalized) ? normalized : "unknown"
}

function safeRelease(value: string): string {
  const normalized = value.trim()
  return SAFE_RELEASE.test(normalized) ? normalized : "unknown"
}

function safeErrorCode(value: string | undefined): string | undefined {
  return value && STABLE_CODE.test(value) ? value : undefined
}

function parseOperationEntry(value: unknown): DiagnosticOperationEntry | null {
  if (
    !isRecord(value) ||
    !exactKeys(
      value,
      ["occurred_at", "operation", "outcome", "duration_bucket"],
      ["error_code", "duration_ms", "context"],
    ) ||
    (value.duration_ms !== undefined && (!Number.isInteger(value.duration_ms) || Number(value.duration_ms) < 0 || Number(value.duration_ms) > 86400000)) ||
    (value.context !== undefined && !validDiagnosticContext(value.context)) ||
    typeof value.occurred_at !== "string" ||
    !Number.isFinite(Date.parse(value.occurred_at)) ||
    typeof value.operation !== "string" ||
    !OPERATIONS.has(value.operation) ||
    typeof value.outcome !== "string" ||
    !OUTCOMES.has(value.outcome as DiagnosticOutcome) ||
    typeof value.duration_bucket !== "string" ||
    !DURATIONS.has(value.duration_bucket as DurationBucket) ||
    (value.error_code !== undefined &&
      (typeof value.error_code !== "string" || !STABLE_CODE.test(value.error_code)))
  ) {
    return null
  }
  return value as DiagnosticOperationEntry
}

function scanReport(report: DiagnosticReport): void {
  const serialized = JSON.stringify(report)
  const forbiddenKeys = /"(?:full_name|student_number|thesis_title|thesis_title_en|content|filename|absolute_path|clipboard|hostname|username|ip_address|mac_address|serial_number|raw_log|message|details)"\s*:/i
  const pathLike = /(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\|file:\/\/)/i
  const credentialLike = /(?:Bearer\s+[A-Za-z0-9._-]+|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|(?:secret|token|password)\s*[=:])/i
  if (
    Buffer.byteLength(serialized, "utf8") > MAX_REPORT_BYTES ||
    forbiddenKeys.test(serialized) ||
    pathLike.test(serialized) ||
    credentialLike.test(serialized)
  ) {
    throw new Error("DIAGNOSTIC_PRIVACY_SCAN_FAILED")
  }
}

export function stableDiagnosticErrorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === "string" && STABLE_CODE.test(error.code)) {
    return error.code
  }
  if (error instanceof Error) {
    const prefix = error.message.split(":", 1)[0]?.trim()
    if (prefix && STABLE_CODE.test(prefix)) return prefix
  }
  return "INTERNAL_ERROR"
}

export class DiagnosticService {
  private readonly directory: string
  private readonly operationsPath: string
  private operations: DiagnosticOperationEntry[] = []
  private prepared: PreparedReport | null = null
  private writeChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly options: {
      userDataPath: string
      appVersion: string
      electronVersion: string
      platform: NodeJS.Platform
      arch: string
      packaged: boolean
      endpoint?: string
      now?: () => Date
    },
  ) {
    this.directory = path.join(options.userDataPath, "diagnostics")
    this.operationsPath = path.join(this.directory, "operations.json")
  }

  private now(): Date {
    return this.options.now?.() ?? new Date()
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await chmod(this.directory, 0o700)
    this.operations = await this.readOperations()
    this.record("app.lifecycle", "success", 0)
  }

  record(
    operation: DiagnosticOperation,
    outcome: DiagnosticOutcome,
    durationMs: number,
    errorCode?: string,
    context?: DiagnosticContext,
  ): void {
    if (!OPERATIONS.has(operation)) return
    const normalizedCode = safeErrorCode(errorCode)
    const entry: DiagnosticOperationEntry = {
      occurred_at: this.now().toISOString(),
      operation,
      outcome,
      duration_bucket: durationBucket(Math.max(0, durationMs)),
      duration_ms: Number.isFinite(durationMs) ? Math.min(86400000, Math.max(0, Math.round(durationMs))) : 0,
      ...(context ? { context: diagnosticContext(context) } : {}),
      ...(normalizedCode ? { error_code: normalizedCode } : {}),
    }
    this.operations.push(entry)
    while (this.operations.length > MAX_OPERATION_ENTRIES || Buffer.byteLength(JSON.stringify(this.operations), "utf8") > MAX_PERSISTED_BYTES) {
      // Prefer retaining the most recent failures over routine successful steps.
      // Keep chronological order and cap the protected portion.
      const failures = this.operations.filter(item => item.outcome === "failure")
      const protectedFailures = new Set(failures.slice(-40))
      const removable = this.operations.findIndex(item => !protectedFailures.has(item))
      this.operations.splice(Math.max(0, removable), 1)
    }
    this.writeChain = this.writeChain
      .then(() => this.writeOperations())
      .catch(() => undefined)
  }

  prepare(
    input: DiagnosticEnvironmentInput,
    services: { telemetryConfigured: boolean; updateConfigured: boolean },
  ): DiagnosticSummary {
    const startedAt = Date.now()
    let sourceFieldsRemoved = 0
    const checks = input.checks.flatMap((check) => {
      if (!KNOWN_ENVIRONMENT_CHECKS.has(check.id) || !SAFE_CHECK_ID.test(check.id)) {
        sourceFieldsRemoved += 1
        return []
      }
      if (check.message !== undefined) sourceFieldsRemoved += 1
      if (check.details !== undefined) sourceFieldsRemoved += 1
      return [{ id: check.id, required: check.required, status: check.status }]
    })
    const platform =
      this.options.platform === "darwin" ||
      this.options.platform === "win32" ||
      this.options.platform === "linux"
        ? this.options.platform
        : "linux"
    const architecture = this.options.arch === "arm64" ? "arm64" : "x64"
    const report: DiagnosticReport = {
      schema_version: "3.0",
      report_id: randomUUID(),
      created_at: this.now().toISOString(),
      application: {
        version: safeVersion(this.options.appVersion),
        electron_version: safeVersion(this.options.electronVersion),
        packaged: this.options.packaged,
      },
      device: {
        platform,
        architecture,
        os_release: safeRelease(os.release()),
        cpu_count_bucket: cpuCountBucket(os.cpus().length),
        memory_bucket: memoryBucket(os.totalmem()),
      },
      environment: {
        ready: input.ready,
        python_version: safeVersion(input.platform.python),
        checks,
      },
      services: {
        telemetry_configured: services.telemetryConfigured,
        update_configured: services.updateConfigured,
      },
      operations: this.operations.slice(-MAX_OPERATION_ENTRIES),
      privacy: {
        scan_status: "passed",
        source_fields_removed: sourceFieldsRemoved,
        blocked_findings: 0,
      },
    }
    scanReport(report)
    const serialized = `${JSON.stringify(report, null, 2)}\n`
    this.prepared = {
      report,
      serialized,
      expiresAt: this.now().getTime() + REPORT_LIFETIME_MS,
    }
    this.record("diagnostic.prepare", "success", Date.now() - startedAt)
    return {
      reportId: report.report_id,
      createdAt: report.created_at,
      sizeBytes: Buffer.byteLength(serialized, "utf8"),
      operationCount: report.operations.length,
      environmentCheckCount: report.environment.checks.length,
      sourceFieldsRemoved,
      privacyStatus: "passed",
    }
  }

  async save(reportId: string, targetPath: string): Promise<void> {
    const startedAt = Date.now()
    const prepared = this.requirePrepared(reportId)
    const absoluteTarget = path.resolve(targetPath)
    await writeFile(absoluteTarget, prepared.serialized, { encoding: "utf8", mode: 0o600 })
    await chmod(absoluteTarget, 0o600)
    this.record("diagnostic.save", "success", Date.now() - startedAt)
  }

  async send(reportId: string): Promise<DiagnosticSendResult> {
    const startedAt = Date.now()
    const request_id = randomUUID()
    let prepared: PreparedReport
    try {
      prepared = this.requirePrepared(reportId)
      scanReport(prepared.report)
      if (!this.options.endpoint) throw new Error("DIAGNOSTIC_REMOTE_UNCONFIGURED")
    } catch (error) {
      this.record("diagnostic.send", "failure", Date.now() - startedAt, stableDiagnosticErrorCode(error), { stage: "report_prepare", request_id })
      throw error
    }
    let response: Response
    try {
      response = await fetch(this.options.endpoint, {
        method: "POST",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prepared.report),
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      this.record("diagnostic.send", "failure", Date.now() - startedAt, "NETWORK_ERROR", { stage: "report_send", request_id, reason: "network_failure" })
      throw new Error("DIAGNOSTIC_SEND_FAILED")
    }
    if (response.status !== 202) {
      this.record("diagnostic.send", "failure", Date.now() - startedAt, "REMOTE_REJECTED", { stage: "report_send", request_id, reason: "http_rejected", http_status: response.status })
      throw new Error("DIAGNOSTIC_SEND_FAILED")
    }
    const receiptStarted = Date.now()
    this.record("diagnostic.step", "success", receiptStarted - startedAt, undefined, { stage: "report_send", request_id, http_status: response.status })
    const payload = await response.json().catch(() => null) as unknown
    if (
      !isRecord(payload) ||
      payload.ok !== true ||
      payload.report_id !== reportId ||
      payload.retention_days !== 30
    ) {
      this.record("diagnostic.send", "failure", Date.now() - startedAt, "REMOTE_INVALID", { stage: "report_receipt", request_id, reason: "receipt_invalid", http_status: response.status })
      throw new Error("DIAGNOSTIC_SEND_FAILED")
    }
    this.record("diagnostic.send", "success", Date.now() - receiptStarted, undefined, { stage: "report_receipt", request_id, http_status: response.status })
    return { sent: true, reportId, retentionDays: 30 }
  }

  async flush(): Promise<void> {
    await this.writeChain
  }

  private requirePrepared(reportId: string): PreparedReport {
    if (
      !this.prepared ||
      this.prepared.report.report_id !== reportId ||
      this.prepared.expiresAt < this.now().getTime()
    ) {
      this.prepared = null
      throw new Error("DIAGNOSTIC_REPORT_EXPIRED")
    }
    return this.prepared
  }

  private async readOperations(): Promise<DiagnosticOperationEntry[]> {
    try {
      const bytes = await readFile(this.operationsPath)
      if (bytes.length > MAX_PERSISTED_BYTES) return []
      const parsed = JSON.parse(bytes.toString("utf8")) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed
        .map(parseOperationEntry)
        .filter((entry): entry is DiagnosticOperationEntry => entry !== null)
        .slice(-MAX_OPERATION_ENTRIES)
    } catch {
      return []
    }
  }

  private async writeOperations(): Promise<void> {
    const temporaryPath = `${this.operationsPath}.tmp`
    const serialized = JSON.stringify(this.operations)
    if (Buffer.byteLength(serialized, "utf8") > MAX_PERSISTED_BYTES) return
    await writeFile(temporaryPath, serialized, { encoding: "utf8", mode: 0o600 })
    await rename(temporaryPath, this.operationsPath)
    await chmod(this.operationsPath, 0o600)
  }
}
