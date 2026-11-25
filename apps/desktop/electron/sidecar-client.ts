import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { diagnosticContext, validDiagnosticContext, type DiagnosticContext } from "./diagnostic-context.js"
import { offlineRuntimePaths } from "./offline-runtime.js"
import { documentFontDirectories } from "./document-fonts.js"

type RequestId = string

export type SidecarMethod =
  | "system.ping"
  | "system.version"
  | "diagnostic.recover"
  | "diagnostic.prepare"
  | "diagnostic.finishPreview"
  | "environment.check"
  | "workspace.open"
  | "workspace.listDocuments"
  | "workspace.saveProfileDraft"
  | "workspace.saveProfile"
  | "workspace.createProfile"
  | "workspace.selectProfile"
  | "workspace.deleteProfile"
  | "workspace.restoreProfile"
  | "workspace.createDocument"
  | "workspace.selectDocument"
  | "workspace.renameDocument"
  | "workspace.deleteDocument"
  | "workspace.restoreDocument"
  | "workspace.purgeDocument"
  | "workspace.installReferenceSample"
  | "workspace.removeReferenceSample"
  | "workspace.saveDraft"
  | "workspace.closeTemporary"
  | "document.check"
  | "preview.generate"
  | "export.preflight"
  | "export.run"
  | "export.history"
  | "export.deleteHistory"
  | "export.resolveArtifact"
  | "template.install"
  | "qa.record"

const FULL_DIAGNOSTIC_METHODS = new Set<SidecarMethod>([
  "environment.check", "document.check", "preview.generate", "export.preflight", "export.run",
  "workspace.saveDraft", "workspace.saveProfile", "workspace.saveProfileDraft",
  "workspace.createDocument", "workspace.open", "template.install", "diagnostic.prepare",
])

const MAX_MESSAGE_BYTES = 1_048_576
const MAX_STARTUP_STDERR_BYTES = 256 * 1024
const MAX_PENDING_REQUESTS = 32
const MAX_SETTLED_IDS = 128
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/
const ALLOWED_METHODS = new Set<SidecarMethod>([
  "system.ping",
  "system.version",
  "diagnostic.recover",
  "diagnostic.prepare",
  "diagnostic.finishPreview",
  "environment.check",
  "workspace.open",
  "workspace.listDocuments",
  "workspace.saveProfileDraft",
  "workspace.saveProfile",
  "workspace.createProfile",
  "workspace.selectProfile",
  "workspace.deleteProfile",
  "workspace.restoreProfile",
  "workspace.createDocument",
  "workspace.selectDocument",
  "workspace.renameDocument",
  "workspace.deleteDocument",
  "workspace.restoreDocument",
  "workspace.purgeDocument",
  "workspace.installReferenceSample",
  "workspace.removeReferenceSample",
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
])
const RECOVERABLE_METHODS = new Set<SidecarMethod>([
  "system.ping",
  "system.version",
  "environment.check",
  "workspace.open",
  "workspace.listDocuments",
  "workspace.selectDocument",
  "document.check",
  "preview.generate",
  "export.history",
  "export.resolveArtifact",
])
const RECOVERABLE_ERROR_CODES = new Set([
  "SIDECAR_START_FAILED",
  "SIDECAR_WRITE_FAILED",
  "SIDECAR_CLOSED",
  "SIDECAR_EXITED",
])

export function resolveSidecarPython(
  backendRoot: string,
  configured = process.env.SZTU_DOCS_PYTHON,
  platform = process.platform,
  fileExists: (candidate: string) => boolean = existsSync,
): string {
  if (configured) return configured
  const repositoryRoot = path.resolve(backendRoot, "..")
  const packagedSidecar = path.join(
    repositoryRoot,
    "sidecar",
    platform === "win32" ? "sztu-docs-backend.exe" : "sztu-docs-backend",
  )
  if (fileExists(packagedSidecar)) return packagedSidecar
  const virtualenvPython =
    platform === "win32"
      ? path.join(repositoryRoot, ".venv", "Scripts", "python.exe")
      : path.join(repositoryRoot, ".venv", "bin", "python")
  return fileExists(virtualenvPython) ? virtualenvPython : platform === "win32" ? "python" : "python3"
}

export function resolveSidecarPath(
  configured = process.env.PATH,
  platform = process.platform,
): string {
  const separator = platform === "win32" ? ";" : ":"
  const candidates = configured?.split(separator).filter(Boolean) ?? []
  if (platform === "darwin") {
    candidates.push(
      "/Library/TeX/texbin",
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      "/usr/local/sbin",
      "/opt/local/bin",
    )
  }
  return [...new Set(candidates)].join(separator)
}

type SuccessEnvelope<T> = {
  protocol: "1.0"
  id: RequestId
  ok: true
  result: T
}

type ErrorEnvelope = {
  protocol: "1.0"
  id: RequestId | null
  ok: false
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

type ResponseEnvelope<T> = SuccessEnvelope<T> | ErrorEnvelope

type ProgressEnvelope = {
  protocol: "1.0"
  event: "request.progress"
  request_id: RequestId
  progress: {
    current: number
    total: number
    message: string
    stage?: string
  }
}

type DiagnosticStep = DiagnosticContext & {
  outcome: "started" | "success" | "failure" | "cancelled"
  duration_ms: number
  error_code?: string
}

export type SidecarDiagnosticObserver = (step: DiagnosticStep) => void

function parseDiagnosticStep(value: unknown): DiagnosticStep | undefined {
  if (!isRecord(value)) return
  const { outcome, duration_ms, error_code, ...context } = value
  if ((outcome !== "started" && outcome !== "success" && outcome !== "failure" && outcome !== "cancelled") ||
      typeof duration_ms !== "number" || !Number.isInteger(duration_ms) || duration_ms < 0 || duration_ms > 86400000 ||
      (error_code !== undefined && (typeof error_code !== "string" || !ERROR_CODE_PATTERN.test(error_code))) ||
      typeof context.stage !== "string" || !validDiagnosticContext(context)) return
  return { ...diagnosticContext(context), outcome, duration_ms, ...(error_code ? { error_code } : {}) }
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
  deadlineReached?: boolean
  onDiagnostic?: SidecarDiagnosticObserver
  diagnosticCaseId?: string
  method: SidecarMethod
  request: string
  activeSteps: Array<{ step: DiagnosticStep; started: number }>
}

export type SidecarRequestOptions = {
  onDeadline?: () => Promise<void>
  cancellationGraceMs?: number
  onDiagnostic?: SidecarDiagnosticObserver
}

export type SidecarClientOptions = {
  role?: "control" | "render"
  appVersion?: string
  retryRequests?: boolean
}

export class SidecarError extends Error {
  diagnosticCaseId?: string
  readonly code: string
  readonly details?: Record<string, unknown>

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = "SidecarError"
    this.code = code
    this.details = details
  }
}

export function shouldRetrySidecarRequest(
  method: SidecarMethod,
  error: unknown,
  attempt: number,
): boolean {
  return (
    attempt === 0 &&
    RECOVERABLE_METHODS.has(method) &&
    error instanceof SidecarError &&
    RECOVERABLE_ERROR_CODES.has(error.code)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional])
  const keys = Object.keys(value)
  return required.every((key) => key in value) && keys.every((key) => allowed.has(key))
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value)
}

export function isSidecarResponseEnvelope(
  value: unknown,
): value is ResponseEnvelope<unknown> {
  if (!isRecord(value)) return false
  const envelope = value
  if (envelope.protocol !== "1.0") return false
  if (envelope.id !== null && !isUuid(envelope.id)) return false
  if (envelope.ok === true) {
    return envelope.id !== null && hasExactKeys(envelope, ["protocol", "id", "ok", "result"])
  }
  if (envelope.ok !== false || !hasExactKeys(envelope, ["protocol", "id", "ok", "error"])) return false
  const error = envelope.error
  if (!isRecord(error) || !hasExactKeys(error, ["code", "message"], ["details"])) return false
  if (typeof error.code !== "string" || !ERROR_CODE_PATTERN.test(error.code)) return false
  if (typeof error.message !== "string" || error.message.length < 1 || error.message.length > 1000) return false
  return error.details === undefined || isRecord(error.details)
}

export function isSidecarProgressEnvelope(value: unknown): value is ProgressEnvelope {
  if (!isRecord(value) || !hasExactKeys(value, ["protocol", "event", "request_id", "progress"])) return false
  if (value.protocol !== "1.0" || value.event !== "request.progress" || !isUuid(value.request_id)) return false
  const progress = value.progress
  if (!isRecord(progress) || !hasExactKeys(progress, ["current", "total", "message"], ["stage"])) return false
  if (!Number.isInteger(progress.current) || !Number.isInteger(progress.total)) return false
  if ((progress.current as number) < 0 || (progress.total as number) < 1 || (progress.current as number) > (progress.total as number)) return false
  if (typeof progress.message !== "string" || progress.message.length < 1 || progress.message.length > 500) return false
  return progress.stage === undefined || (typeof progress.stage === "string" && progress.stage.length >= 1 && progress.stage.length <= 100)
}

export class SidecarClient {
  private process: ChildProcessWithoutNullStreams | undefined
  private buffer = Buffer.alloc(0)
  private protocolFailureBytes: Buffer | undefined
  private generation = 0
  private engineResponded = false
  private startupStderr: Buffer[] = []
  private startupStderrBytes = 0
  private startupStderrTruncated = false
  private readonly pending = new Map<RequestId, PendingRequest>()
  private readonly settledIds = new Set<RequestId>()
  private readonly pythonExecutable: string
  private stopping: Promise<void> | undefined
  private stopError: SidecarError | undefined

  get running(): boolean { return Boolean(this.process && !this.process.killed && !this.stopping) }

  constructor(
    private readonly backendRoot: string,
    private readonly dataRoot: string,
    pythonExecutable?: string,
    private readonly options: SidecarClientOptions = {},
  ) {
    this.pythonExecutable =
      pythonExecutable ?? resolveSidecarPython(backendRoot)
  }

  async request<T>(
    method: SidecarMethod,
    params: Record<string, unknown> = {},
    timeoutMs = 15_000,
    requestOptions: SidecarRequestOptions = {},
  ): Promise<T> {
    if (!ALLOWED_METHODS.has(method)) {
      throw new SidecarError("INVALID_METHOD", "Sidecar method is not allowed.")
    }
    if (this.pending.size >= MAX_PENDING_REQUESTS) {
      throw new SidecarError("TOO_MANY_PENDING_REQUESTS", "Too many sidecar requests are pending.")
    }

    try {
      return await this.requestOnce<T>(method, params, timeoutMs, requestOptions)
    } catch (error) {
      if (this.options.retryRequests === false || !shouldRetrySidecarRequest(method, error, 0)) throw error
      return this.requestOnce<T>(method, params, timeoutMs, requestOptions)
    }
  }

  private requestOnce<T>(
    method: SidecarMethod,
    params: Record<string, unknown>,
    timeoutMs: number,
    options: SidecarRequestOptions,
  ): Promise<T> {
    const id = randomUUID()
    const message = `${JSON.stringify({ protocol: "1.0", id, method, params, ...(options.onDiagnostic ? { diagnostics: true } : {}) })}\n`
    if (Buffer.byteLength(message, "utf8") > MAX_MESSAGE_BYTES) {
      return Promise.reject(new SidecarError("MESSAGE_TOO_LARGE", "Sidecar request exceeds the size limit."))
    }
    if (this.stopping) return Promise.reject(new SidecarError("SIDECAR_STOPPING", "The document engine is stopping. Please try again after it exits."))
    const child = this.ensureProcess()

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        void this.handleDeadline(id, options)
      }, timeoutMs)

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
        onDiagnostic: options.onDiagnostic,
        diagnosticCaseId: FULL_DIAGNOSTIC_METHODS.has(method)
          ? method === "preview.generate" && typeof params.request_id === "string" ? params.request_id : id
          : undefined,
        method,
        request: message,
        activeSteps: [],
      })
      child.stdin.write(message, "utf8", (error) => {
        if (!error) return
        const request = this.pending.get(id)
        if (!request) return
        this.failProcess("SIDECAR_WRITE_FAILED", error)
      })
    })
  }

  dispose(): void {
    if (this.process && !this.process.killed) {
      this.process.kill()
    }
    this.process = undefined
    this.buffer = Buffer.alloc(0)
    this.generation += 1
    this.rejectAll(new SidecarError("SIDECAR_STOPPED", "Sidecar stopped."))
  }

  /** Stop confirmation precedes rejection, so a timed-out mutation cannot commit later. */
  async stop(error = new SidecarError("SIDECAR_STOPPED", "Sidecar stopped.")): Promise<void> {
    if (this.stopping) return this.stopping
    const child = this.process
    if (!child) { this.rejectAll(error); return }
    this.stopError = error
    this.stopping = new Promise<void>((resolve) => {
      const finish = () => { clearTimeout(forceKill); resolve() }
      child.once("close", finish)
      const forceKill = setTimeout(() => { child.kill("SIGKILL") }, 1_000)
      forceKill.unref?.()
      if (child.exitCode === null && child.signalCode === null) child.kill()
    })
    try { await this.stopping } finally { this.stopping = undefined; this.stopError = undefined }
  }

  private async handleDeadline(id: string, options: SidecarRequestOptions): Promise<void> {
    const pending = this.pending.get(id)
    if (!pending) return
    pending.deadlineReached = true
    if (!options.onDeadline) {
      await this.stop(new SidecarError("REQUEST_TIMEOUT", "操作超时，请重新打开应用，并查看文档是否已保存或导出。"))
      return
    }
    // Keep the request pending until a backend terminal response or confirmed exit.
    // A completion racing the cancellation remains a real successful completion.
    pending.timeout = setTimeout(() => {
      if (!this.pending.has(id)) return
      void this.stop(new SidecarError("REQUEST_OUTCOME_UNKNOWN", "无法确认本次任务是否完成，请查看导出记录及保存文件夹。"))
    }, Math.min(10_000, Math.max(1, options.cancellationGraceMs ?? 10_000)))
    try { await options.onDeadline() } catch {
      if (this.pending.has(id)) await this.stop(new SidecarError("REQUEST_OUTCOME_UNKNOWN", "取消失败，请查看导出记录及保存文件夹，确认是否已生成文件。"))
    }
  }

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.process && !this.process.killed) {
      return this.process
    }

    const sourceRoot = path.join(this.backendRoot, "src")
    const bundledEnginesRoot = path.resolve(
      this.backendRoot,
      "../bundled-template-engines",
    )
    this.buffer = Buffer.alloc(0)
    this.protocolFailureBytes = undefined
    const generation = ++this.generation
    this.engineResponded = false
    this.startupStderr = []
    this.startupStderrBytes = 0
    this.startupStderrTruncated = false
    const packagedSidecar = path.basename(this.pythonExecutable).startsWith("sztu-docs-backend")
    const sidecarArguments = packagedSidecar ? [] : ["-m", "sztu_docs_backend"]
    let runtimePaths: string[]
    try {
      runtimePaths = offlineRuntimePaths(this.backendRoot)
    } catch (error) {
      // A missing or mislocated engine is not a crash: name it so the student can repair it.
      throw new SidecarError("RENDER_ENGINE_UNAVAILABLE",
        "编译环境缺失或安装在不支持的位置（例如包含中文的路径），分页预览和 PDF 导出不可用；请运行最新安装包修复后重启应用。",
        { reason: error instanceof Error ? error.message : String(error) })
    }
    const child = spawn(this.pythonExecutable, sidecarArguments, {
      cwd: this.backendRoot,
      windowsHide: true,
      env: {
        PATH: [...runtimePaths, resolveSidecarPath()].join(path.delimiter),
        LANG: process.env.LANG,
        LC_ALL: process.env.LC_ALL,
        HOME: process.env.HOME,
        USERPROFILE: process.env.USERPROFILE,
        PROGRAMFILES: process.env.PROGRAMFILES,
        "PROGRAMFILES(X86)": process.env["PROGRAMFILES(X86)"],
        LOCALAPPDATA: process.env.LOCALAPPDATA,
        SYSTEMROOT: process.env.SYSTEMROOT,
        WINDIR: process.env.WINDIR,
        COMSPEC: process.env.COMSPEC,
        PATHEXT: process.env.PATHEXT,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        PYTHONPATH: sourceRoot,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
        SZTU_DOCS_DATA_DIR: this.dataRoot,
        SZTU_DOCS_APP_VERSION: this.options.appVersion,
        SZTU_DOCS_SIDECAR_ROLE: this.options.role ?? "control",
        SZTU_DOCS_RECOVER_INTERRUPTED: this.options.role === "render" || generation > 1 ? "0" : "1",
        SZTU_DOCS_TEMPLATE_PACKS_DIR: path.resolve(this.backendRoot, "../template-packs"),
        SZTU_DOCS_BUNDLED_ENGINES_DIR: existsSync(bundledEnginesRoot)
          ? bundledEnginesRoot
          : undefined,
        SZTU_DOCS_PROPOSAL_ENGINE_DIR: process.env.SZTU_DOCS_PROPOSAL_ENGINE_DIR,
        SZTU_DOCS_TASK_BOOK_ENGINE_DIR: process.env.SZTU_DOCS_TASK_BOOK_ENGINE_DIR,
        SZTU_DOCS_MIDTERM_ENGINE_DIR: process.env.SZTU_DOCS_MIDTERM_ENGINE_DIR,
        SZTU_DOCS_ADVISOR_REVIEW_ENGINE_DIR: process.env.SZTU_DOCS_ADVISOR_REVIEW_ENGINE_DIR,
        SZTU_DOCS_REVIEWER_REVIEW_ENGINE_DIR: process.env.SZTU_DOCS_REVIEWER_REVIEW_ENGINE_DIR,
        SZTU_DOCS_DEFENSE_RECORD_ENGINE_DIR: process.env.SZTU_DOCS_DEFENSE_RECORD_ENGINE_DIR,
        SZTU_DOCS_GRADE_ASSESSMENT_ENGINE_DIR: process.env.SZTU_DOCS_GRADE_ASSESSMENT_ENGINE_DIR,
        SZTU_DOCS_CJK_VALIDATOR: process.env.SZTU_DOCS_CJK_VALIDATOR,
        SZTU_FONT_DIR: documentFontDirectories(this.backendRoot),
        SZTU_FZXIAOBIAOSONG_FONT: process.env.SZTU_FZXIAOBIAOSONG_FONT,
        SZTU_STXINGKAI_FONT: process.env.SZTU_STXINGKAI_FONT,
        SZTU_SIMSUN_FONT: process.env.SZTU_SIMSUN_FONT,
        SZTU_SIMHEI_FONT: process.env.SZTU_SIMHEI_FONT,
        SZTU_TIMES_REGULAR_FONT: process.env.SZTU_TIMES_REGULAR_FONT,
        SZTU_TIMES_BOLD_FONT: process.env.SZTU_TIMES_BOLD_FONT,
        SZTU_TIMES_ITALIC_FONT: process.env.SZTU_TIMES_ITALIC_FONT,
        SZTU_TIMES_BOLD_ITALIC_FONT: process.env.SZTU_TIMES_BOLD_ITALIC_FONT,
      },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    })

    child.stdout.on("data", (chunk: Buffer) => {
      if (generation === this.generation) this.handleStdout(chunk)
    })
    // The engine records request stderr itself. Keep boot errors before
    // the engine is able to start handling requests.
    child.stderr.on("data", (chunk: Buffer) => {
      if (generation !== this.generation || this.engineResponded) return
      const remaining = MAX_STARTUP_STDERR_BYTES - this.startupStderrBytes
      if (remaining > 0) {
        const part = Buffer.from(chunk.subarray(0, remaining))
        this.startupStderr.push(part)
        this.startupStderrBytes += part.length
      }
      this.startupStderrTruncated ||= chunk.length > remaining
    })
    child.on("error", error => { if (generation === this.generation) this.failProcess("SIDECAR_START_FAILED", error) })
    child.on("close", (code, signal) => {
      if (generation !== this.generation) return
      this.process = undefined
      const errorCode = code === 0 && signal === null ? "SIDECAR_CLOSED" : "SIDECAR_EXITED"
      if (this.buffer.length) this.protocolFailureBytes = this.buffer
      this.buffer = Buffer.alloc(0)
      this.rejectAll(this.stopError ?? new SidecarError(errorCode, "Sidecar process exited."), { code, signal })
    })

    this.process = child
    return child
  }

  private handleStdout(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    if (this.buffer.length > MAX_MESSAGE_BYTES) {
      this.protocolFailureBytes = this.buffer.subarray(0, MAX_MESSAGE_BYTES)
      this.failProcess("MESSAGE_TOO_LARGE")
      return
    }
    const generation = this.generation
    let newlineIndex = this.buffer.indexOf(10)
    while (newlineIndex >= 0) {
      const rawLine = this.buffer.subarray(0, newlineIndex + 1)
      const line = rawLine.toString("utf8").trim()
      this.buffer = this.buffer.subarray(newlineIndex + 1)
      if (line) {
        this.protocolFailureBytes = rawLine
        this.handleLine(line)
        if (generation !== this.generation) return
        this.protocolFailureBytes = undefined
      }
      newlineIndex = this.buffer.indexOf(10)
    }
  }

  private handleLine(line: string): void {
    let candidate: unknown
    try {
      candidate = JSON.parse(line)
    } catch {
      this.failProcess("INVALID_SIDECAR_JSON")
      return
    }
    const declaredId = isRecord(candidate) ? candidate.id ?? candidate.request_id : undefined
    if (isUuid(declaredId) && !this.pending.has(declaredId)) this.protocolFailureBytes = undefined

    if (isRecord(candidate) && candidate.event === "request.diagnostic") {
      if (candidate.protocol !== "1.0" || !hasExactKeys(candidate, ["protocol", "event", "request_id", "step"]) || !isUuid(candidate.request_id)) {
        this.failProcess("INVALID_SIDECAR_RESPONSE")
        return
      }
      this.markEngineResponded()
      const pending = this.pending.get(candidate.request_id)
      const step = parseDiagnosticStep(candidate.step)
      if (pending?.onDiagnostic && step) {
        if (step.outcome === "started") {
          if (pending.activeSteps.length < 16) pending.activeSteps.push({ step, started: Date.now() })
        } else {
          const index = pending.activeSteps.findLastIndex(active => active.step.stage === step.stage && active.step.tool === step.tool)
          if (index >= 0) pending.activeSteps.splice(index, 1)
          pending.onDiagnostic(step)
        }
      }
      return
    }

    if (isSidecarProgressEnvelope(candidate)) {
      if (!this.pending.has(candidate.request_id) && !this.settledIds.has(candidate.request_id)) {
        this.failProcess("UNKNOWN_RESPONSE_ID")
      } else {
        this.markEngineResponded()
      }
      return
    }

    if (!isSidecarResponseEnvelope(candidate)) {
      this.failProcess("INVALID_SIDECAR_RESPONSE")
      return
    }
    const envelope = candidate

    if (envelope.id === null) {
      return
    }
    const pending = this.pending.get(envelope.id)
    if (!pending) {
      if (!this.settledIds.has(envelope.id)) {
        this.failProcess("UNKNOWN_RESPONSE_ID")
      }
      return
    }
    clearTimeout(pending.timeout)
    this.markEngineResponded()
    this.pending.delete(envelope.id)
    this.rememberSettled(envelope.id)

    if (envelope.ok) {
      pending.resolve(envelope.result)
      return
    }
    if (pending.deadlineReached && ["EXPORT_CANCELLED", "PREVIEW_CANCELLED", "REQUEST_CANCELLED"].includes(envelope.error.code)) {
      pending.reject(new SidecarError("REQUEST_TIMEOUT", "操作超时，已取消本次任务。", { ...envelope.error.details, cancellation_confirmed: true }))
    } else pending.reject(new SidecarError(envelope.error.code, envelope.error.message, envelope.error.details))
  }

  private rejectAll(error: Error, processFailure?: unknown): void {
    const onlyRequest = this.pending.size === 1
    for (const [id, request] of this.pending) {
      const last = request.activeSteps.at(-1)
      if (last) request.onDiagnostic?.({
        ...last.step, outcome: "failure", reason: "interrupted",
        duration_ms: Math.min(86400000, Math.max(0, Date.now() - last.started)),
        error_code: error instanceof SidecarError ? error.code : "SIDECAR_STOPPED",
      })
      clearTimeout(request.timeout)
      if (error instanceof SidecarError) {
        const rejected = new SidecarError(error.code, error.message, error.details)
        const caseId = request.diagnosticCaseId
        if (request.onDiagnostic && caseId && UUID_PATTERN.test(caseId) && error.code !== "SIDECAR_STOPPED") {
          rejected.diagnosticCaseId = caseId
          const directory = path.join(this.dataRoot, "diagnostics", "full", caseId)
          try {
            mkdirSync(directory, { recursive: true, mode: 0o700 })
            const started = path.join(directory, "capture-start.json")
            if (!existsSync(started)) {
              writeFileSync(started, JSON.stringify({ reportId: caseId, operation: request.method, createdAt: Date.now() / 1000 }), { mode: 0o600 })
              writeFileSync(path.join(directory, "request.json"), request.request, { mode: 0o600 })
              if (onlyRequest && this.startupStderrBytes > 0) {
                writeFileSync(path.join(directory, "engine-startup-stderr.bin"), Buffer.concat(this.startupStderr), { mode: 0o600 })
                if (this.startupStderrTruncated) {
                  writeFileSync(path.join(directory, "engine-startup-stderr-truncated"), "", { mode: 0o600 })
                }
              }
            }
            const protocolFragmentCaptured = onlyRequest && this.protocolFailureBytes !== undefined
            if (protocolFragmentCaptured && this.protocolFailureBytes) {
              writeFileSync(path.join(directory, "engine-protocol-fragment.bin"), this.protocolFailureBytes, { mode: 0o600 })
            }
            writeFileSync(path.join(directory, "engine-interruption.json"), JSON.stringify({
              code: error.code, executable: this.pythonExecutable, cwd: this.backendRoot,
              detail: processFailure instanceof Error ? processFailure.stack : processFailure,
              protocol_fragment: this.protocolFailureBytes ? protocolFragmentCaptured ? "captured" : "multiple_pending_requests" : undefined,
            }), { mode: 0o600 })
          } catch { /* Preserve the original request failure. */ }
        }
        request.reject(rejected)
      } else request.reject(error)
      this.rememberSettled(id)
    }
    this.pending.clear()
    this.startupStderr = []
    this.startupStderrBytes = 0
    this.startupStderrTruncated = false
    this.protocolFailureBytes = undefined
  }

  private markEngineResponded(): void {
    if (this.engineResponded) return
    this.engineResponded = true
    this.startupStderr = []
    this.startupStderrBytes = 0
    this.startupStderrTruncated = false
  }

  private failProcess(code: string, cause?: Error): void {
    const child = this.process
    this.process = undefined
    this.buffer = Buffer.alloc(0)
    this.generation += 1
    if (child && !child.killed) child.kill()
    this.rejectAll(new SidecarError(code, "Sidecar protocol validation failed."), cause)
  }

  private rememberSettled(id: RequestId): void {
    this.settledIds.add(id)
    if (this.settledIds.size <= MAX_SETTLED_IDS) return
    const oldest = this.settledIds.values().next().value
    if (oldest) this.settledIds.delete(oldest)
  }

}
