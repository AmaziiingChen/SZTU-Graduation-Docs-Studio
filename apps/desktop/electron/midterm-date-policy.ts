import { createPublicKey, randomUUID, verify } from "node:crypto"
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

import { canonicalJson } from "./update-service.js"

export const MIDTERM_DATE_POLICY_INTERVAL_MS = 30 * 60 * 1000
const MAX_POLICY_BYTES = 64 * 1024

export type MidtermDateRule = {
  college: string
  startDate: string
  endDate: string
}

export type MidtermDatePolicyStatus = {
  state: "unconfigured" | "loading" | "ready" | "error"
  rules: MidtermDateRule[]
}

type SignedPolicy = {
  payload: {
    schema_version: "1.0"
    published_at: string
    rules: Array<{ college: string; start_date: string; end_date: string }>
  }
  signature: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value)
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const year = Number(value.slice(0, 4))
  if (year < 1900 || year > 2100) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function parseAndVerifyMidtermDatePolicy(value: unknown, publicKeyPem: string): MidtermDateRule[] {
  if (!isRecord(value) || !exactKeys(value, ["payload", "signature"]) ||
      typeof value.signature !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.signature)) {
    throw new Error("Signed date policy is invalid.")
  }
  const signature = Buffer.from(value.signature, "base64")
  const publicKey = createPublicKey(publicKeyPem)
  if (signature.length !== 64 || publicKey.asymmetricKeyType !== "ed25519" ||
      !verify(null, Buffer.from(canonicalJson(value.payload), "utf8"), publicKey, signature)) {
    throw new Error("Date policy signature verification failed.")
  }
  const payload = value.payload
  if (!isRecord(payload) || !exactKeys(payload, ["schema_version", "published_at", "rules"]) ||
      payload.schema_version !== "1.0" || typeof payload.published_at !== "string" ||
      !Number.isFinite(Date.parse(payload.published_at)) ||
      !Array.isArray(payload.rules) || payload.rules.length > 50) {
    throw new Error("Date policy payload is invalid.")
  }
  const colleges = new Set<string>()
  return payload.rules.map((item: unknown): MidtermDateRule => {
    if (!isRecord(item) || !exactKeys(item, ["college", "start_date", "end_date"]) ||
        typeof item.college !== "string" || item.college !== item.college.trim() ||
        item.college.length < 1 || item.college.length > 100 ||
        !validDate(item.start_date) || !validDate(item.end_date) ||
        item.start_date > item.end_date) {
      throw new Error("Date policy rule is invalid.")
    }
    const college = item.college.normalize("NFC")
    if (colleges.has(college)) throw new Error("Date policy contains duplicate colleges.")
    colleges.add(college)
    return { college, startDate: item.start_date, endDate: item.end_date }
  })
}

export class MidtermDatePolicyService {
  private status: MidtermDatePolicyStatus
  private timer: NodeJS.Timeout | undefined
  private readonly listeners = new Set<(status: MidtermDatePolicyStatus) => void>()
  private readonly cachePath: string

  constructor(private readonly options: {
    userDataPath: string
    policyUrl?: string
    publicKeyPem?: string
    fetchImpl?: typeof fetch
  }) {
    this.cachePath = path.join(options.userDataPath, "midterm-date-policy.json")
    this.status = { state: options.policyUrl && options.publicKeyPem ? "loading" : "unconfigured", rules: [] }
  }

  getStatus(): MidtermDatePolicyStatus { return this.status }

  onStatus(listener: (status: MidtermDatePolicyStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async initialize(): Promise<void> {
    if (!this.options.policyUrl || !this.options.publicKeyPem) return
    try {
      const bytes = await readFile(this.cachePath)
      if (bytes.length > MAX_POLICY_BYTES) throw new Error("Cached date policy is too large.")
      const rules = parseAndVerifyMidtermDatePolicy(JSON.parse(bytes.toString("utf8")) as SignedPolicy, this.options.publicKeyPem)
      this.setStatus({ state: "ready", rules })
    } catch {
      // A missing or invalid cache cannot grant an unverified restriction.
      this.setStatus({ state: "loading", rules: [] })
    }
  }

  start(): void {
    if (!this.options.policyUrl || !this.options.publicKeyPem || this.timer) return
    void this.checkNow()
    this.timer = setInterval(() => void this.checkNow(), MIDTERM_DATE_POLICY_INTERVAL_MS)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  async checkNow(): Promise<MidtermDatePolicyStatus> {
    if (!this.options.policyUrl || !this.options.publicKeyPem) return this.status
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    timeout.unref()
    try {
      const response = await (this.options.fetchImpl ?? fetch)(this.options.policyUrl, {
        method: "GET", credentials: "omit", redirect: "error", signal: controller.signal,
      })
      if (!response.ok || Number(response.headers.get("content-length") ?? "0") > MAX_POLICY_BYTES) {
        throw new Error("Date policy request failed.")
      }
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.length > MAX_POLICY_BYTES) throw new Error("Date policy is too large.")
      const rules = parseAndVerifyMidtermDatePolicy(JSON.parse(bytes.toString("utf8")) as SignedPolicy, this.options.publicKeyPem)
      const temporary = `${this.cachePath}.${randomUUID()}.tmp`
      try {
        await mkdir(path.dirname(this.cachePath), { recursive: true, mode: 0o700 })
        await writeFile(temporary, bytes, { mode: 0o600 })
        await rename(temporary, this.cachePath)
      } catch {
        // A valid response still applies for this session if local caching fails.
        await unlink(temporary).catch(() => undefined)
      }
      this.setStatus({ state: "ready", rules })
    } catch {
      this.setStatus({ state: "error", rules: this.status.rules })
    } finally {
      clearTimeout(timeout)
    }
    return this.status
  }

  private setStatus(status: MidtermDatePolicyStatus): void {
    this.status = status
    for (const listener of this.listeners) listener(status)
  }
}
