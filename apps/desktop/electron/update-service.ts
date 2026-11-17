import { createHash, createPublicKey, randomUUID, verify } from "node:crypto"
import { mkdir, open, rename, stat, unlink } from "node:fs/promises"
import path from "node:path"
import type { DiagnosticContext } from "./diagnostic-context.js"

export const UPDATE_INTERVAL_MS = 30 * 60 * 1000
const MAX_MANIFEST_BYTES = 128 * 1024
// A 400 MB installer legitimately takes minutes. Give up on a connection that never
// answers, or on a transfer that stops making progress, instead of on total elapsed time.
const CONNECT_TIMEOUT_MS = 30_000
const STALL_TIMEOUT_MS = 45_000
const MAX_ARTIFACT_BYTES = 1024 * 1024 * 1024
const MAX_NOTICE_TITLE_LENGTH = 80
const MAX_NOTICE_BODY_LENGTH = 1_000
const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/

export type ReleaseAnnouncement = {
  id: string
  title: string
  body: string
  severity: "info" | "important" | "critical"
  startsAt: string
  endsAt: string | null
  dismissible: boolean
}

export type ReleaseControl = {
  updatePolicy: "optional" | "recommended" | "required"
  minimumSupportedVersion: string | null
  requiresUpgrade: boolean
  serviceStatus: "normal" | "maintenance" | "retired"
  helpUrl: string | null
  announcement: ReleaseAnnouncement | null
}

export type UpdateStatus =
  | { state: "unconfigured" }
  | { state: "idle" }
  | { state: "checking"; control?: ReleaseControl }
  | { state: "up_to_date"; checkedAt: string; control?: ReleaseControl }
  | { state: "available"; version: string; sizeBytes: number; downloadFailed?: boolean; control?: ReleaseControl }
  | { state: "downloading"; version: string; downloadedBytes: number; sizeBytes: number; phase: "transferring" | "verifying"; control?: ReleaseControl }
  | { state: "downloaded"; version: string; downloadedAt: string; control?: ReleaseControl }
  | { state: "error"; code: "CHECK_FAILED" | "MANIFEST_INVALID" | "DOWNLOAD_FAILED"; control?: ReleaseControl }

type UpdateArtifact = {
  platform: NodeJS.Platform
  arch: string
  url: string
  sha256: string
  size_bytes: number
}

export type UpdateManifestPayload = {
  schema_version: "1.0" | "2.0"
  channel: "stable"
  version: string
  published_at: string
  artifacts: UpdateArtifact[]
  control?: {
    update_policy: "optional" | "recommended" | "required"
    minimum_supported_version: string | null
    service_status: "normal" | "maintenance" | "retired"
    help_url: string | null
    announcement: {
      id: string
      title: string
      body: string
      severity: "info" | "important" | "critical"
      starts_at: string
      ends_at: string | null
      dismissible: boolean
    } | null
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value)
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value)
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite JSON number.")
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (!isObject(value)) throw new Error("Value is not canonical JSON.")
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`
}

function parseSemver(value: string): [number, number, number, string | null] {
  const match = SEMVER_PATTERN.exec(value)
  if (!match) throw new Error("Invalid semantic version.")
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? null]
}

export function compareSemver(left: string, right: string): number {
  const a = parseSemver(left)
  const b = parseSemver(right)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return (a[index] as number) - (b[index] as number)
  }
  if (a[3] === b[3]) return 0
  if (a[3] === null) return 1
  if (b[3] === null) return -1
  return a[3].localeCompare(b[3])
}

function validArtifactUrl(value: string): string {
  const parsed = new URL(value)
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new Error("Update artifact URL must use HTTPS.")
  }
  return parsed.toString()
}

function validOptionalHttpsUrl(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== "string") throw new Error("Help URL is invalid.")
  return validArtifactUrl(value)
}

function parseControl(
  value: unknown,
  currentVersion: string,
  now: Date,
): ReleaseControl {
  if (
    !isObject(value) ||
    !exactKeys(value, [
      "update_policy",
      "minimum_supported_version",
      "service_status",
      "help_url",
      "announcement",
    ]) ||
    !["optional", "recommended", "required"].includes(String(value.update_policy)) ||
    !["normal", "maintenance", "retired"].includes(String(value.service_status)) ||
    !(
      value.minimum_supported_version === null ||
      (typeof value.minimum_supported_version === "string" &&
        SEMVER_PATTERN.test(value.minimum_supported_version))
    )
  ) {
    throw new Error("Release control is invalid.")
  }
  let announcement: ReleaseAnnouncement | null = null
  if (value.announcement !== null) {
    const raw = value.announcement
    if (
      !isObject(raw) ||
      !exactKeys(raw, [
        "id",
        "title",
        "body",
        "severity",
        "starts_at",
        "ends_at",
        "dismissible",
      ]) ||
      typeof raw.id !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(raw.id) ||
      typeof raw.title !== "string" ||
      raw.title.trim().length < 1 ||
      raw.title.length > MAX_NOTICE_TITLE_LENGTH ||
      typeof raw.body !== "string" ||
      raw.body.trim().length < 1 ||
      raw.body.length > MAX_NOTICE_BODY_LENGTH ||
      !["info", "important", "critical"].includes(String(raw.severity)) ||
      typeof raw.starts_at !== "string" ||
      !Number.isFinite(Date.parse(raw.starts_at)) ||
      !(
        raw.ends_at === null ||
        (typeof raw.ends_at === "string" && Number.isFinite(Date.parse(raw.ends_at)))
      ) ||
      typeof raw.dismissible !== "boolean"
    ) {
      throw new Error("Release announcement is invalid.")
    }
    const startsAt = new Date(raw.starts_at)
    const endsAt = raw.ends_at === null ? null : new Date(raw.ends_at as string)
    if (endsAt && endsAt <= startsAt) throw new Error("Announcement time range is invalid.")
    if (startsAt <= now && (!endsAt || now < endsAt)) {
      announcement = {
        id: raw.id,
        title: raw.title.trim(),
        body: raw.body.trim(),
        severity: raw.severity as ReleaseAnnouncement["severity"],
        startsAt: startsAt.toISOString(),
        endsAt: endsAt?.toISOString() ?? null,
        dismissible: raw.dismissible,
      }
    }
  }
  const minimumSupportedVersion = value.minimum_supported_version as string | null
  return {
    updatePolicy: value.update_policy as ReleaseControl["updatePolicy"],
    minimumSupportedVersion,
    requiresUpgrade:
      minimumSupportedVersion !== null &&
      compareSemver(currentVersion, minimumSupportedVersion) < 0,
    serviceStatus: value.service_status as ReleaseControl["serviceStatus"],
    helpUrl: validOptionalHttpsUrl(value.help_url),
    announcement,
  }
}

export function parseAndVerifyManifest(
  value: unknown,
  publicKeyPem: string,
): UpdateManifestPayload {
  if (!isObject(value) || !exactKeys(value, ["payload", "signature"])) {
    throw new Error("Signed manifest envelope is invalid.")
  }
  if (typeof value.signature !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.signature)) {
    throw new Error("Manifest signature is invalid.")
  }
  const signature = Buffer.from(value.signature, "base64")
  if (signature.length !== 64) throw new Error("Manifest signature length is invalid.")
  const publicKey = createPublicKey(publicKeyPem)
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Manifest public key must be Ed25519.")
  }
  if (
    !verify(
      null,
      Buffer.from(canonicalJson(value.payload), "utf8"),
      publicKey,
      signature,
    )
  ) {
    throw new Error("Manifest signature verification failed.")
  }
  const payload = value.payload
  if (!isObject(payload)) throw new Error("Manifest payload is invalid.")
  const schemaVersion = payload.schema_version
  const expectedKeys = schemaVersion === "2.0"
    ? ["schema_version", "channel", "version", "published_at", "artifacts", "control"]
    : ["schema_version", "channel", "version", "published_at", "artifacts"]
  if (
    !exactKeys(payload, expectedKeys) ||
    (schemaVersion !== "1.0" && schemaVersion !== "2.0") ||
    payload.channel !== "stable" ||
    typeof payload.version !== "string" ||
    !SEMVER_PATTERN.test(payload.version) ||
    typeof payload.published_at !== "string" ||
    !Number.isFinite(Date.parse(payload.published_at)) ||
    !Array.isArray(payload.artifacts) ||
    (schemaVersion === "1.0" && payload.artifacts.length < 1) ||
    payload.artifacts.length > 20
  ) {
    throw new Error("Manifest payload is invalid.")
  }
  const artifacts = payload.artifacts.map((raw): UpdateArtifact => {
    if (
      !isObject(raw) ||
      !exactKeys(raw, ["platform", "arch", "url", "sha256", "size_bytes"]) ||
      (raw.platform !== "darwin" && raw.platform !== "win32" && raw.platform !== "linux") ||
      typeof raw.arch !== "string" ||
      !["arm64", "x64"].includes(raw.arch) ||
      typeof raw.url !== "string" ||
      typeof raw.sha256 !== "string" ||
      !SHA256_PATTERN.test(raw.sha256) ||
      !Number.isInteger(raw.size_bytes) ||
      (raw.size_bytes as number) < 1 ||
      (raw.size_bytes as number) > MAX_ARTIFACT_BYTES
    ) {
      throw new Error("Manifest artifact is invalid.")
    }
    return {
      platform: raw.platform,
      arch: raw.arch,
      url: validArtifactUrl(raw.url),
      sha256: raw.sha256,
      size_bytes: raw.size_bytes as number,
    }
  })
  if (schemaVersion === "2.0") {
    parseControl(payload.control, "0.0.0", new Date(0))
  }
  return {
    schema_version: schemaVersion,
    channel: "stable",
    version: payload.version,
    published_at: payload.published_at,
    artifacts,
    ...(schemaVersion === "2.0"
      ? { control: payload.control as UpdateManifestPayload["control"] }
      : {}),
  }
}

export class UpdateService {
  private status: UpdateStatus
  private timer: NodeJS.Timeout | undefined
  private checking = false
  private downloading = false
  private availableUpdate: { version: string; artifact: UpdateArtifact } | undefined
  private downloadedPath: string | undefined
  private downloadedVersion: string | undefined
  private downloadedSha256: string | undefined
  private downloadedAt: string | undefined
  private currentControl: ReleaseControl | undefined
  private readonly listeners = new Set<(status: UpdateStatus) => void>()

  constructor(
    private readonly options: {
      userDataPath: string
      currentVersion: string
      platform: NodeJS.Platform
      arch: string
      manifestUrl?: string
      publicKeyPem?: string
      fetchImpl?: FetchLike
      now?: () => Date
      onDiagnostic?: (outcome: "success" | "failure", duration: number, code: string | undefined, context: DiagnosticContext) => void
      onOutcome?: (
        outcome: "up_to_date" | "available" | "downloaded" | "failed",
        version?: string,
      ) => void | Promise<void>
    },
  ) {
    this.status =
      options.manifestUrl && options.publicKeyPem
        ? { state: "idle" }
        : { state: "unconfigured" }
  }

  getStatus(): UpdateStatus {
    return this.status
  }

  onStatus(listener: (status: UpdateStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(): void {
    if (!this.options.manifestUrl || !this.options.publicKeyPem || this.timer) return
    void this.checkNow()
    this.timer = setInterval(() => void this.checkNow(), UPDATE_INTERVAL_MS)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  revealDownloadedPath(): string | null {
    return this.status.state === "downloaded" ? this.downloadedPath ?? null : null
  }

  getHelpUrl(): string | null {
    return this.currentControl?.helpUrl ?? null
  }

  async checkNow(): Promise<UpdateStatus> {
    if (!this.options.manifestUrl || !this.options.publicKeyPem || this.checking || this.downloading) {
      return this.status
    }
    this.checking = true
    this.setStatus({
      state: "checking",
      ...(this.currentControl ? { control: this.currentControl } : {}),
    })
    const requestId = randomUUID()
    let stage = "manifest_fetch", started = Date.now()
    const mark = (outcome: "success" | "failure", code?: string, reason?: string) =>
      this.options.onDiagnostic?.(outcome, Date.now() - started, code, { stage, request_id: requestId, ...(reason ? { reason } : {}) })
    try {
      const bytes = await this.fetchWithTimeout(this.options.manifestUrl, 10_000, async (response, signal) => {
        if (!response.ok || !response.body) throw new Error("Manifest request failed.")
        const declaredLength = Number(response.headers.get("content-length") ?? "0")
        if (declaredLength > MAX_MANIFEST_BYTES) throw new Error("Manifest is too large.")
        const chunks: Uint8Array[] = []
        let size = 0
        const reader = response.body.getReader()
        try {
          while (true) {
            const chunk = await this.readChunk(reader, signal)
            if (chunk.done) break
            size += chunk.value.byteLength
            if (size > MAX_MANIFEST_BYTES) throw new Error("Manifest is too large.")
            chunks.push(chunk.value)
          }
          return Buffer.concat(chunks, size)
        } finally { void reader.cancel().catch(() => undefined); reader.releaseLock() }
      })
      mark("success")
      stage = "manifest_verify"
      started = Date.now()
      let manifest: UpdateManifestPayload
      try {
        manifest = parseAndVerifyManifest(
          JSON.parse(bytes.toString("utf8")) as unknown,
          this.options.publicKeyPem,
        )
      } catch {
        mark("failure", "MANIFEST_INVALID")
        this.setStatus({ state: "error", code: "MANIFEST_INVALID", ...(this.currentControl ? { control: this.currentControl } : {}) })
        await this.options.onOutcome?.("failed")
        return this.status
      }
      let control: ReleaseControl | undefined
      if (manifest.schema_version === "2.0") {
        try {
          control = parseControl(
            manifest.control,
            this.options.currentVersion,
            this.options.now?.() ?? new Date(),
          )
        } catch {
          mark("failure", "MANIFEST_INVALID")
          this.setStatus({ state: "error", code: "MANIFEST_INVALID", ...(this.currentControl ? { control: this.currentControl } : {}) })
          await this.options.onOutcome?.("failed")
          return this.status
        }
      }
      mark("success")
      this.currentControl = control
      if (compareSemver(manifest.version, this.options.currentVersion) <= 0 ||
          (manifest.schema_version === "2.0" && manifest.artifacts.length === 0)) {
        this.availableUpdate = undefined
        this.setStatus({
          state: "up_to_date",
          checkedAt: (this.options.now?.() ?? new Date()).toISOString(),
          ...(control ? { control } : {}),
        })
        await this.options.onOutcome?.("up_to_date")
        return this.status
      }
      stage = "platform_match"
      started = Date.now()
      const artifact = manifest.artifacts.find(
        (item) =>
          item.platform === this.options.platform && item.arch === this.options.arch,
      )
      if (!artifact) throw new Error("No update artifact for this platform.")
      mark("success")
      if (
        this.downloadedVersion === manifest.version &&
        this.downloadedSha256 === artifact.sha256 &&
        this.downloadedPath &&
        this.downloadedAt &&
        (await this.downloadedArtifactAvailable(artifact))
      ) {
        this.setStatus({
          state: "downloaded",
          version: manifest.version,
          downloadedAt: this.downloadedAt,
          ...(control ? { control } : {}),
        })
        return this.status
      }
      const alreadyKnown = this.availableUpdate?.version === manifest.version &&
        this.availableUpdate.artifact.sha256 === artifact.sha256
      this.availableUpdate = { version: manifest.version, artifact }
      this.setStatus({
        state: "available",
        version: manifest.version,
        sizeBytes: artifact.size_bytes,
        ...(control ? { control } : {}),
      })
      if (!alreadyKnown) await this.options.onOutcome?.("available", manifest.version)
      return this.status
    } catch {
      mark("failure", "CHECK_FAILED", stage === "platform_match" ? "artifact_unavailable" : "network_failure")
      this.setStatus({ state: "error", code: "CHECK_FAILED", ...(this.currentControl ? { control: this.currentControl } : {}) })
      await this.options.onOutcome?.("failed")
      return this.status
    } finally {
      this.checking = false
    }
  }

  async downloadNow(): Promise<UpdateStatus> {
    if (this.checking || this.downloading || this.status.state !== "available" || !this.availableUpdate) return this.status
    const { version, artifact } = this.availableUpdate
    this.downloading = true
    const control = this.currentControl
    this.setStatus({ state: "downloading", version, downloadedBytes: 0, sizeBytes: artifact.size_bytes, phase: "transferring", ...(control ? { control } : {}) })
    const requestId = randomUUID()
    let stage = "update_download", started = Date.now()
    let reason = "transfer_failed"
    const advance = (next: string) => {
      this.options.onDiagnostic?.("success", Date.now() - started, undefined, { stage, request_id: requestId })
      stage = next
      started = Date.now()
      reason = next === "update_verify" ? "hash_mismatch" : "output_write_failed"
    }
    try {
      this.downloadedPath = await this.downloadArtifact(version, artifact, advance, value => { reason = value })
      this.options.onDiagnostic?.("success", Date.now() - started, undefined, { stage, request_id: requestId })
      this.downloadedVersion = version
      this.downloadedSha256 = artifact.sha256
      this.downloadedAt = (this.options.now?.() ?? new Date()).toISOString()
      this.setStatus({ state: "downloaded", version, downloadedAt: this.downloadedAt, ...(control ? { control } : {}) })
      await this.options.onOutcome?.("downloaded", version)
    } catch {
      this.options.onDiagnostic?.("failure", Date.now() - started, "UPDATE_DOWNLOAD_FAILED", { stage, request_id: requestId, reason })
      this.setStatus({ state: "available", version, sizeBytes: artifact.size_bytes, downloadFailed: true, ...(control ? { control } : {}) })
      await this.options.onOutcome?.("failed", version)
    } finally {
      this.downloading = false
    }
    return this.status
  }

  private setStatus(status: UpdateStatus): void {
    this.status = status
    for (const listener of this.listeners) listener(status)
  }

  private async fetchWithTimeout<T>(
    url: string,
    timeoutMs: number,
    consume: (response: Response, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController()
    let responseBody: ReadableStream<Uint8Array> | null = null
    let rejectDeadline!: (error: Error) => void
    const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject })
    const timeout = setTimeout(() => {
      controller.abort()
      if (responseBody && !responseBody.locked) void responseBody.cancel().catch(() => undefined)
      rejectDeadline(new Error("Update request timed out."))
    }, timeoutMs)
    timeout.unref()
    try {
      const operation = (this.options.fetchImpl ?? fetch)(url, {
        method: "GET",
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
      }).then((response) => {
        responseBody = response.body
        if (controller.signal.aborted) {
          void response.body?.cancel().catch(() => undefined)
          throw new Error("Update request timed out.")
        }
        return consume(response, controller.signal)
      })
      return await Promise.race([operation, deadline])
    } finally {
      clearTimeout(timeout)
    }
  }

  /** Connect deadline plus a no-progress deadline; every received chunk re-arms the latter. */
  private async fetchWithProgressTimeout<T>(
    url: string,
    connectMs: number,
    stallMs: number,
    consume: (response: Response, signal: AbortSignal, touch: () => void) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController()
    let responseBody: ReadableStream<Uint8Array> | null = null
    let rejectDeadline!: (error: Error) => void
    const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject })
    let timer: ReturnType<typeof setTimeout> | undefined
    const stale = () => {
      if (timer) clearTimeout(timer)
      timer = undefined
      controller.abort()
      if (responseBody && !responseBody.locked) void responseBody.cancel().catch(() => undefined)
      rejectDeadline(new Error("Update request timed out."))
    }
    const arm = (ms: number) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(stale, ms)
      timer.unref?.()
    }
    arm(connectMs)
    try {
      const operation = (this.options.fetchImpl ?? fetch)(url, {
        method: "GET",
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
      }).then((response) => {
        responseBody = response.body
        if (controller.signal.aborted) {
          void response.body?.cancel().catch(() => undefined)
          throw new Error("Update request timed out.")
        }
        arm(stallMs)
        return consume(response, controller.signal, () => arm(stallMs))
      })
      return await Promise.race([operation, deadline])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private readChunk(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal): Promise<ReadableStreamReadResult<Uint8Array>> {
    if (signal.aborted) return Promise.reject(new Error("Update request timed out."))
    return new Promise((resolve, reject) => {
      const aborted = () => {
        reject(new Error("Update request timed out."))
        void reader.cancel().catch(() => undefined)
      }
      signal.addEventListener("abort", aborted, { once: true })
      reader.read().then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted))
    })
  }

  private async downloadArtifact(
    version: string,
    artifact: UpdateArtifact,
    advance: (stage: string) => void,
    classify: (reason: string) => void,
  ): Promise<string> {
    return this.fetchWithProgressTimeout(artifact.url, CONNECT_TIMEOUT_MS, STALL_TIMEOUT_MS, async (response, signal, touch) => {
      if (!response.ok || !response.body) {
        classify("http_rejected")
        throw new Error("Update download failed.")
      }
      classify("output_write_failed")
      const directory = path.join(this.options.userDataPath, "updates")
      await mkdir(directory, { recursive: true, mode: 0o700 })
      if (signal.aborted) throw new Error("Update request timed out.")
      const extension = path.extname(new URL(artifact.url).pathname).toLowerCase()
      const safeExtension = [".dmg", ".zip", ".exe", ".msi", ".gz"].includes(extension)
        ? extension
        : ".update"
      const target = path.join(directory, `sztu-docs-${version}-${artifact.platform}-${artifact.arch}${safeExtension}`)
      const temporary = `${target}.${randomUUID()}.tmp`
      const handle = await open(temporary, "wx", 0o600)
      const hash = createHash("sha256")
      let size = 0, committed = false
      let lastProgressAt = 0
      const reader = response.body.getReader()
      try {
        while (true) {
          classify("transfer_failed")
          const chunk = await this.readChunk(reader, signal)
          if (chunk.done) break
          touch()
          size += chunk.value.byteLength
          if (size > artifact.size_bytes || size > MAX_ARTIFACT_BYTES) {
            classify("size_mismatch")
            throw new Error("Update artifact exceeded the signed size.")
          }
          hash.update(chunk.value)
          classify("output_write_failed")
          await handle.write(chunk.value)
          const now = Date.now()
          if (now - lastProgressAt >= 200 || size === artifact.size_bytes) {
            lastProgressAt = now
            this.setStatus({ state: "downloading", version, downloadedBytes: size, sizeBytes: artifact.size_bytes, phase: "transferring", ...(this.currentControl ? { control: this.currentControl } : {}) })
          }
        }
        await handle.close()
        this.setStatus({ state: "downloading", version, downloadedBytes: size, sizeBytes: artifact.size_bytes, phase: "verifying", ...(this.currentControl ? { control: this.currentControl } : {}) })
        advance("update_verify")
        if (size !== artifact.size_bytes || hash.digest("hex") !== artifact.sha256) {
          classify(size !== artifact.size_bytes ? "size_mismatch" : "hash_mismatch")
          throw new Error("Update artifact integrity verification failed.")
        }
        advance("update_write")
        if (signal.aborted) throw new Error("Update request timed out.")
        // Replace the existing cache only after complete signature-bound verification.
        await rename(temporary, target)
        committed = true
        const descriptor = await stat(target)
        if (!descriptor.isFile() || descriptor.size !== artifact.size_bytes) {
          throw new Error("Downloaded update file is invalid.")
        }
        return target
      } finally {
        void reader.cancel().catch(() => undefined)
        reader.releaseLock()
        await handle.close().catch(() => undefined)
        if (!committed) await unlink(temporary).catch(() => undefined)
      }
    })
  }

  private async downloadedArtifactAvailable(
    artifact: UpdateArtifact,
  ): Promise<boolean> {
    if (!this.downloadedPath) return false
    try {
      const handle = await open(this.downloadedPath, "r")
      try {
        const descriptor = await handle.stat()
        if (!descriptor.isFile() || descriptor.size !== artifact.size_bytes) return false
        const hash = createHash("sha256")
        const buffer = Buffer.alloc(64 * 1024)
        while (true) {
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
          if (!bytesRead) break
          hash.update(buffer.subarray(0, bytesRead))
        }
        return hash.digest("hex") === artifact.sha256
      } finally { await handle.close() }
    } catch {
      return false
    }
  }
}
