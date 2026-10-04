import { randomUUID } from "node:crypto"
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

export const TELEMETRY_NOTICE_VERSION = "1.1"
export const TELEMETRY_INTERVAL_MS = 30 * 60 * 1000
const INSTALLATION_ID_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000
const MAX_QUEUE_LENGTH = 1_000
const MAX_BATCH_LENGTH = 100
const MAX_BATCH_BYTES = 256 * 1024
const MAX_COMPLETED_DOCUMENTS = 10_000

type TelemetryDocumentType = "proposal" | "task_book" | "midterm" | "advisor_review" | "reviewer_review" | "defense_record" | "grade_assessment"

export type TelemetryView =
  | "profile"
  | "proposal"
  | "task_book"
  | "midterm"
  | "advisor_review"
  | "reviewer_review"
  | "defense_record"
  | "grade_assessment"
  | "inspection"

export type TelemetryUsageEventInput =
  | { name: "view_opened"; view: TelemetryView }
  | {
      name: "document_action"
      action: "check" | "preview" | "template_sync" | "export" | "qa_record"
      documentType: TelemetryDocumentType
      outcome: "success" | "failure" | "cancelled"
      errorCode?: string
      formatCount?: number
    }

export type DocumentCompletionResult = {
  recorded: boolean
  total: number | null
}

type TelemetryAttribute = string | number | boolean
type TelemetryAttributes = Record<string, TelemetryAttribute>

export type TelemetryEvent = {
  schema_version: "1.0"
  event_id: string
  installation_id: string
  session_id: string
  name: "app_started" | "heartbeat" | "app_stopped" | "usage_event" | "update_event"
  occurred_at: string
  app_version: string
  platform: NodeJS.Platform
  arch: string
  attributes: TelemetryAttributes
}

type TelemetryState = {
  schema_version: "1.0"
  installation_id: string
  rotates_at: string
  notice_version: string | null
  accepted_at: string | null
}

type FetchResponse = {
  ok: boolean
  status: number
  json?: () => Promise<unknown>
}
type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<FetchResponse>

export type PrivacyNoticeStatus = {
  noticeVersion: string
  acknowledged: boolean
  acceptedAt: string | null
  telemetryConfigured: boolean
}

const TELEMETRY_VIEWS = new Set<TelemetryView>([
  "profile",
  "proposal",
  "task_book",
  "midterm",
  "advisor_review",
  "reviewer_review",
  "defense_record",
  "grade_assessment",
  "inspection",
])
const TELEMETRY_ACTIONS = new Set([
  "check",
  "preview",
  "template_sync",
  "export",
  "qa_record",
])
const DOCUMENT_TYPES = new Set(["proposal", "task_book", "midterm", "advisor_review", "reviewer_review", "defense_record", "grade_assessment"])
const OUTCOMES = new Set(["success", "failure", "cancelled"])
const STABLE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DOCUMENT_ID_PATTERN =
  /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i
const EVENT_NAMES = new Set([
  "app_started",
  "heartbeat",
  "app_stopped",
  "usage_event",
  "update_event",
])
const ATTRIBUTE_KEYS = new Set([
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

function isObject(value: unknown): value is Record<string, unknown> {
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

export function parseTelemetryUsageEvent(value: unknown): TelemetryUsageEventInput {
  if (!isObject(value) || typeof value.name !== "string") {
    throw new Error("Telemetry event must be an object with a supported name.")
  }
  if (value.name === "view_opened") {
    if (
      !exactKeys(value, ["name", "view"]) ||
      !TELEMETRY_VIEWS.has(value.view as TelemetryView)
    ) {
      throw new Error("Telemetry view event is invalid.")
    }
    return { name: "view_opened", view: value.view as TelemetryView }
  }
  if (value.name === "document_action") {
    if (
      !exactKeys(
        value,
        ["name", "action", "documentType", "outcome"],
        ["errorCode", "formatCount"],
      ) ||
      !TELEMETRY_ACTIONS.has(value.action as string) ||
      !DOCUMENT_TYPES.has(value.documentType as string) ||
      !OUTCOMES.has(value.outcome as string) ||
      (value.errorCode !== undefined &&
        (typeof value.errorCode !== "string" || !STABLE_ERROR_CODE.test(value.errorCode))) ||
      (value.formatCount !== undefined &&
        (!Number.isInteger(value.formatCount) ||
          (value.formatCount as number) < 1 ||
          (value.formatCount as number) > 3))
    ) {
      throw new Error("Telemetry document action is invalid.")
    }
    return {
      name: "document_action",
      action: value.action as
        | "check"
        | "preview"
        | "template_sync"
        | "export"
        | "qa_record",
      documentType: value.documentType as TelemetryDocumentType,
      outcome: value.outcome as "success" | "failure" | "cancelled",
      ...(value.errorCode === undefined ? {} : { errorCode: value.errorCode as string }),
      ...(value.formatCount === undefined ? {} : { formatCount: value.formatCount as number }),
    } as TelemetryUsageEventInput
  }
  throw new Error("Telemetry event name is not allowlisted.")
}

function newState(now: Date): TelemetryState {
  return {
    schema_version: "1.0",
    installation_id: randomUUID(),
    rotates_at: new Date(now.getTime() + INSTALLATION_ID_LIFETIME_MS).toISOString(),
    notice_version: null,
    accepted_at: null,
  }
}

function parseState(value: unknown): TelemetryState | null {
  if (
    !isObject(value) ||
    !exactKeys(value, [
      "schema_version",
      "installation_id",
      "rotates_at",
      "notice_version",
      "accepted_at",
    ]) ||
    value.schema_version !== "1.0" ||
    typeof value.installation_id !== "string" ||
    !UUID_PATTERN.test(value.installation_id) ||
    typeof value.rotates_at !== "string" ||
    (value.notice_version !== null && typeof value.notice_version !== "string") ||
    (value.accepted_at !== null && typeof value.accepted_at !== "string")
  ) {
    return null
  }
  return value as TelemetryState
}

function validPersistedAttributes(value: unknown): value is TelemetryAttributes {
  if (!isObject(value) || Object.keys(value).length > 10) return false
  return Object.entries(value).every(
    ([key, item]) =>
      ATTRIBUTE_KEYS.has(key) &&
      ((typeof item === "string" && item.length <= 64) ||
        typeof item === "boolean" ||
        (typeof item === "number" && Number.isFinite(item))),
  )
}

function uptimeBucket(milliseconds: number): string {
  const minutes = milliseconds / 60_000
  if (minutes < 5) return "under_5m"
  if (minutes < 30) return "5m_to_30m"
  if (minutes < 60) return "30m_to_1h"
  if (minutes < 180) return "1h_to_3h"
  return "over_3h"
}

export class TelemetryService {
  private readonly directory: string
  private readonly statePath: string
  private readonly queuePath: string
  private readonly completedDocumentsPath: string
  private state: TelemetryState | null = null
  private queue: TelemetryEvent[] = []
  private completedDocumentIds = new Set<string>()
  private readonly sessionId = randomUUID()
  private readonly sessionStartedAt: number
  private timer: NodeJS.Timeout | undefined
  private started = false
  private persistence: Promise<void> = Promise.resolve()

  constructor(
    private readonly options: {
      userDataPath: string
      appVersion: string
      platform: NodeJS.Platform
      arch: string
      packaged: boolean
      endpoint?: string
      fetchImpl?: FetchLike
      now?: () => Date
    },
  ) {
    this.directory = path.join(options.userDataPath, "telemetry")
    this.statePath = path.join(this.directory, "state.json")
    this.queuePath = path.join(this.directory, "queue.json")
    this.completedDocumentsPath = path.join(this.directory, "completed-documents.json")
    this.sessionStartedAt = this.now().getTime()
  }

  private now(): Date {
    return this.options.now?.() ?? new Date()
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    this.state = await this.readState()
    this.queue = await this.readQueue()
    this.completedDocumentIds = await this.readCompletedDocuments()
    if (Date.parse(this.state.rotates_at) <= this.now().getTime()) {
      this.state = {
        ...this.state,
        installation_id: randomUUID(),
        rotates_at: new Date(
          this.now().getTime() + INSTALLATION_ID_LIFETIME_MS,
        ).toISOString(),
      }
      await this.writeState()
    }
  }

  getPrivacyStatus(): PrivacyNoticeStatus {
    const state = this.requireState()
    return {
      noticeVersion: TELEMETRY_NOTICE_VERSION,
      acknowledged:
        state.notice_version === TELEMETRY_NOTICE_VERSION &&
        state.accepted_at !== null,
      acceptedAt: state.accepted_at,
      telemetryConfigured: Boolean(this.options.endpoint),
    }
  }

  async acceptNotice(): Promise<PrivacyNoticeStatus> {
    const state = this.requireState()
    this.state = {
      ...state,
      notice_version: TELEMETRY_NOTICE_VERSION,
      accepted_at: this.now().toISOString(),
    }
    await this.writeState()
    return this.getPrivacyStatus()
  }

  async start(): Promise<void> {
    if (this.started || !this.getPrivacyStatus().acknowledged) return
    this.started = true
    await this.record("app_started", {
      launch_mode: this.options.packaged ? "packaged" : "development",
    })
    void this.flush()
    this.timer = setInterval(() => {
      void this.record("heartbeat", {
        uptime_bucket: uptimeBucket(this.now().getTime() - this.sessionStartedAt),
      }).then(() => this.flush())
    }, TELEMETRY_INTERVAL_MS)
    this.timer.unref()
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    if (!this.started) { await this.persistence; return }
    this.started = false
    await this.record("app_stopped", {
      uptime_bucket: uptimeBucket(this.now().getTime() - this.sessionStartedAt),
    })
  }

  async recordUsage(input: unknown): Promise<void> {
    const event = parseTelemetryUsageEvent(input)
    const attributes: TelemetryAttributes = { event_name: event.name }
    if (event.name === "view_opened") {
      attributes.view = event.view
    } else {
      attributes.action = event.action
      attributes.document_type = event.documentType
      attributes.outcome = event.outcome
      if (event.errorCode) attributes.error_code = event.errorCode
      if (event.formatCount) attributes.format_count = event.formatCount
    }
    await this.record("usage_event", attributes)
  }

  async recordDocumentCompletion(
    documentId: string,
    documentType: TelemetryDocumentType,
  ): Promise<DocumentCompletionResult> {
    if (!DOCUMENT_ID_PATTERN.test(documentId) || !DOCUMENT_TYPES.has(documentType)) {
      throw new Error("Document completion input is invalid.")
    }
    if (this.completedDocumentIds.has(documentId)) {
      return { recorded: false, total: await this.getCompletionCount() }
    }

    await this.record("usage_event", {
      event_name: "document_completed",
      document_type: documentType,
    })
    this.completedDocumentIds.add(documentId)
    await this.writeCompletedDocuments()
    await this.flush()
    return { recorded: true, total: await this.getCompletionCount() }
  }

  async getCompletionCount(): Promise<number | null> {
    if (!this.options.endpoint || !this.getPrivacyStatus().acknowledged) return null
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8_000)
    timeout.unref()
    try {
      const endpoint = new URL(this.options.endpoint)
      if (!/\/events\/?$/.test(endpoint.pathname)) return null
      endpoint.search = ""
      endpoint.searchParams.set("aggregate", "completed_documents")
      const response = await (this.options.fetchImpl ?? fetch)(endpoint.toString(), {
        method: "GET",
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
      })
      if (!response.ok || !response.json) return null
      const payload = (await response.json()) as unknown
      if (
        !isObject(payload) ||
        payload.ok !== true ||
        !Number.isSafeInteger(payload.completed_documents) ||
        (payload.completed_documents as number) < 0
      ) {
        return null
      }
      return payload.completed_documents as number
    } catch {
      return null
    } finally {
      clearTimeout(timeout)
    }
  }

  async recordUpdate(
    outcome: "up_to_date" | "available" | "downloaded" | "failed",
    version?: string,
  ): Promise<void> {
    await this.record("update_event", {
      outcome,
      ...(version && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)
        ? { target_version: version }
        : {}),
    })
  }

  async flush(): Promise<boolean> {
    if (!this.options.endpoint || this.queue.length === 0) return false
    const batch: TelemetryEvent[] = []
    for (const event of this.queue.slice(0, MAX_BATCH_LENGTH)) {
      const candidate = [...batch, event]
      const bytes = Buffer.byteLength(JSON.stringify(candidate), "utf8")
      if (bytes > MAX_BATCH_BYTES) break
      batch.push(event)
    }
    if (batch.length === 0) return false
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    timeout.unref()
    try {
      const response = await (this.options.fetchImpl ?? fetch)(
        this.options.endpoint,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            schema_version: "1.0",
            sent_at: this.now().toISOString(),
            events: batch,
          }),
          credentials: "omit",
          redirect: "error",
          signal: controller.signal,
        },
      )
      if (!response.ok) return false
      const sentIds = new Set(batch.map((event) => event.event_id))
      this.queue = this.queue.filter((event) => !sentIds.has(event.event_id))
      await this.writeQueue()
      return true
    } catch {
      return false
    } finally {
      clearTimeout(timeout)
    }
  }

  private async record(
    name: TelemetryEvent["name"],
    attributes: TelemetryAttributes,
  ): Promise<void> {
    const state = this.requireState()
    if (!this.getPrivacyStatus().acknowledged) return
    this.queue.push({
      schema_version: "1.0",
      event_id: randomUUID(),
      installation_id: state.installation_id,
      session_id: this.sessionId,
      name,
      occurred_at: this.now().toISOString(),
      app_version: this.options.appVersion,
      platform: this.options.platform,
      arch: this.options.arch,
      attributes,
    })
    if (this.queue.length > MAX_QUEUE_LENGTH) {
      this.queue = this.queue.slice(-MAX_QUEUE_LENGTH)
    }
    await this.writeQueue()
  }

  private requireState(): TelemetryState {
    if (!this.state) throw new Error("Telemetry service is not initialized.")
    return this.state
  }

  private async readState(): Promise<TelemetryState> {
    try {
      const parsed = JSON.parse(await readFile(this.statePath, "utf8")) as unknown
      return parseState(parsed) ?? newState(this.now())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) {
        throw error
      }
      return newState(this.now())
    }
  }

  private async readQueue(): Promise<TelemetryEvent[]> {
    try {
      const parsed = JSON.parse(await readFile(this.queuePath, "utf8")) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed
        .filter(
          (item): item is TelemetryEvent =>
            isObject(item) &&
            item.schema_version === "1.0" &&
            typeof item.event_id === "string" &&
            UUID_PATTERN.test(item.event_id) &&
            typeof item.installation_id === "string" &&
            UUID_PATTERN.test(item.installation_id) &&
            typeof item.session_id === "string" &&
            UUID_PATTERN.test(item.session_id) &&
            typeof item.name === "string" &&
            EVENT_NAMES.has(item.name) &&
            typeof item.occurred_at === "string" &&
            typeof item.app_version === "string" &&
            typeof item.platform === "string" &&
            typeof item.arch === "string" &&
            validPersistedAttributes(item.attributes),
        )
        .slice(-MAX_QUEUE_LENGTH)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) {
        throw error
      }
      return []
    }
  }

  private async readCompletedDocuments(): Promise<Set<string>> {
    try {
      const parsed = JSON.parse(
        await readFile(this.completedDocumentsPath, "utf8"),
      ) as unknown
      if (!Array.isArray(parsed)) return new Set()
      return new Set(
        parsed
          .filter((item): item is string =>
            typeof item === "string" && DOCUMENT_ID_PATTERN.test(item),
          )
          .slice(-MAX_COMPLETED_DOCUMENTS),
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) {
        throw error
      }
      return new Set()
    }
  }

  private async writeState(): Promise<void> {
    await this.atomicWrite(this.statePath, this.requireState())
  }

  private async writeQueue(): Promise<void> {
    await this.atomicWrite(this.queuePath, this.queue)
  }

  private async writeCompletedDocuments(): Promise<void> {
    const documentIds = [...this.completedDocumentIds].slice(-MAX_COMPLETED_DOCUMENTS)
    this.completedDocumentIds = new Set(documentIds)
    await this.atomicWrite(this.completedDocumentsPath, documentIds)
  }

  private async atomicWrite(target: string, value: unknown): Promise<void> {
    const snapshot = `${JSON.stringify(value)}\n`
    const write = this.persistence.then(async () => {
      const temporary = `${target}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, snapshot, {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        })
        await rename(temporary, target)
        await chmod(target, 0o600)
      } catch (error) {
        await unlink(temporary).catch(() => undefined)
        throw error
      }
    })
    // A failed write is reported to its caller and does not poison later writes.
    this.persistence = write.catch(() => undefined)
    await write
  }
}
