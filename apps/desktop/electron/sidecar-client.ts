import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"
import path from "node:path"

type RequestId = string

export type SidecarMethod =
  | "system.ping"
  | "system.version"
  | "environment.check"
  | "workspace.open"
  | "workspace.saveProfile"
  | "workspace.createDocument"
  | "workspace.selectDocument"
  | "workspace.saveDraft"
  | "workspace.restorePrevious"
  | "workspace.closeTemporary"
  | "document.check"
  | "export.preflight"
  | "export.run"
  | "export.history"
  | "export.resolveArtifact"
  | "template.install"
  | "qa.record"

const MAX_MESSAGE_BYTES = 1_048_576
const MAX_PENDING_REQUESTS = 32
const MAX_SETTLED_IDS = 128
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/
const ALLOWED_METHODS = new Set<SidecarMethod>([
  "system.ping",
  "system.version",
  "environment.check",
  "workspace.open",
  "workspace.saveProfile",
  "workspace.createDocument",
  "workspace.selectDocument",
  "workspace.saveDraft",
  "workspace.restorePrevious",
  "workspace.closeTemporary",
  "document.check",
  "export.preflight",
  "export.run",
  "export.history",
  "export.resolveArtifact",
  "template.install",
  "qa.record",
])

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

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

export class SidecarError extends Error {
  readonly code: string
  readonly details?: Record<string, unknown>

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = "SidecarError"
    this.code = code
    this.details = details
  }
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
  private buffer = ""
  private generation = 0
  private readonly pending = new Map<RequestId, PendingRequest>()
  private readonly settledIds = new Set<RequestId>()

  constructor(
    private readonly backendRoot: string,
    private readonly dataRoot: string,
    private readonly pythonExecutable = process.env.SZTU_DOCS_PYTHON || "python3",
  ) {}

  request<T>(
    method: SidecarMethod,
    params: Record<string, unknown> = {},
    timeoutMs = 15_000,
  ): Promise<T> {
    if (!ALLOWED_METHODS.has(method)) {
      return Promise.reject(new SidecarError("INVALID_METHOD", "Sidecar method is not allowed."))
    }
    if (this.pending.size >= MAX_PENDING_REQUESTS) {
      return Promise.reject(new SidecarError("TOO_MANY_PENDING_REQUESTS", "Too many sidecar requests are pending."))
    }
    const id = randomUUID()
    const message = `${JSON.stringify({ protocol: "1.0", id, method, params })}\n`
    if (Buffer.byteLength(message, "utf8") > MAX_MESSAGE_BYTES) {
      return Promise.reject(new SidecarError("MESSAGE_TOO_LARGE", "Sidecar request exceeds the size limit."))
    }
    const child = this.ensureProcess()

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        this.rememberSettled(id)
        reject(new SidecarError("REQUEST_TIMEOUT", "Sidecar request timed out."))
      }, timeoutMs)

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      })
      child.stdin.write(message, "utf8", (error) => {
        if (!error) return
        const request = this.pending.get(id)
        if (!request) return
        clearTimeout(request.timeout)
        this.pending.delete(id)
        this.rememberSettled(id)
        request.reject(new SidecarError("SIDECAR_WRITE_FAILED", "Could not write to the sidecar."))
      })
    })
  }

  dispose(): void {
    if (this.process && !this.process.killed) {
      this.process.kill()
    }
    this.process = undefined
    this.buffer = ""
    this.generation += 1
    this.rejectAll(new SidecarError("SIDECAR_STOPPED", "Sidecar stopped."))
  }

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.process && !this.process.killed) {
      return this.process
    }

    const sourceRoot = path.join(this.backendRoot, "src")
    this.buffer = ""
    const generation = ++this.generation
    const child = spawn(this.pythonExecutable, ["-m", "sztu_docs_backend"], {
      cwd: this.backendRoot,
      env: {
        PATH: process.env.PATH,
        LANG: process.env.LANG,
        LC_ALL: process.env.LC_ALL,
        HOME: process.env.HOME,
        USERPROFILE: process.env.USERPROFILE,
        SYSTEMROOT: process.env.SYSTEMROOT,
        COMSPEC: process.env.COMSPEC,
        PATHEXT: process.env.PATHEXT,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        PYTHONPATH: sourceRoot,
        SZTU_DOCS_DATA_DIR: this.dataRoot,
        SZTU_DOCS_TEMPLATE_PACKS_DIR: path.resolve(this.backendRoot, "../template-packs"),
        SZTU_DOCS_PROPOSAL_ENGINE_DIR: process.env.SZTU_DOCS_PROPOSAL_ENGINE_DIR,
        SZTU_DOCS_CJK_VALIDATOR: process.env.SZTU_DOCS_CJK_VALIDATOR,
      },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    })

    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      if (generation === this.generation) this.handleStdout(chunk)
    })
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", () => {
      console.error("[document-engine] A diagnostic was emitted; details are suppressed.")
    })
    child.on("error", () => this.failProcess("SIDECAR_START_FAILED"))
    child.on("exit", (code, signal) => {
      if (generation !== this.generation) return
      this.process = undefined
      this.buffer = ""
      const errorCode = code === 0 && signal === null ? "SIDECAR_CLOSED" : "SIDECAR_EXITED"
      this.rejectAll(new SidecarError(errorCode, "Sidecar process exited."))
    })

    this.process = child
    return child
  }

  private handleStdout(chunk: string): void {
    this.buffer += chunk
    if (Buffer.byteLength(this.buffer, "utf8") > MAX_MESSAGE_BYTES) {
      this.failProcess("MESSAGE_TOO_LARGE")
      return
    }
    let newlineIndex = this.buffer.indexOf("\n")
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim()
      this.buffer = this.buffer.slice(newlineIndex + 1)
      if (line) {
        this.handleLine(line)
      }
      newlineIndex = this.buffer.indexOf("\n")
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

    if (isSidecarProgressEnvelope(candidate)) {
      if (!this.pending.has(candidate.request_id) && !this.settledIds.has(candidate.request_id)) {
        this.failProcess("UNKNOWN_RESPONSE_ID")
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
    this.pending.delete(envelope.id)
    this.rememberSettled(envelope.id)

    if (envelope.ok) {
      pending.resolve(envelope.result)
      return
    }
    pending.reject(new SidecarError(envelope.error.code, envelope.error.message, envelope.error.details))
  }

  private rejectAll(error: Error): void {
    for (const [id, request] of this.pending) {
      clearTimeout(request.timeout)
      request.reject(error)
      this.rememberSettled(id)
    }
    this.pending.clear()
  }

  private failProcess(code: string): void {
    const child = this.process
    this.process = undefined
    this.buffer = ""
    this.generation += 1
    if (child && !child.killed) child.kill()
    this.rejectAll(new SidecarError(code, "Sidecar protocol validation failed."))
  }

  private rememberSettled(id: RequestId): void {
    this.settledIds.add(id)
    if (this.settledIds.size <= MAX_SETTLED_IDS) return
    const oldest = this.settledIds.values().next().value
    if (oldest) this.settledIds.delete(oldest)
  }

}
