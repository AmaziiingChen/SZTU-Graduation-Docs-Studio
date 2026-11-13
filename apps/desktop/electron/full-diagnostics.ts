import { createHash } from "node:crypto"
import { chmod, copyFile, readdir, readFile, rm, stat } from "node:fs/promises"
import path from "node:path"

const CASE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_AGE_MS = 48 * 60 * 60 * 1000
export const FULL_CASE_UPLOAD_LIMIT = 8 * 1024 * 1024

export type FullDiagnosticCase = {
  reportId: string
  operation: string
  createdAt: number
  files: { name: string; sizeBytes: number }[]
  missing: string[]
  excluded?: string[]
  sizeBytes: number
  uploadLimitBytes: number
}

export class FullDiagnosticError extends Error {
  readonly code = "FULL_DIAGNOSTIC_FAILED"
}

export class FullDiagnostics {
  private readonly root: string

  constructor(userDataPath: string, private readonly endpoint?: string) {
    this.root = path.join(userDataPath, "diagnostics", "full")
  }

  async removeExpired(): Promise<void> {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(error => {
      if (error.code === "ENOENT") return []
      throw error
    })
    await Promise.all(entries.filter(item => item.isDirectory() && CASE_ID.test(item.name)).map(async item => {
      const directory = path.join(this.root, item.name)
      const info = await stat(directory)
      if (Date.now() - info.mtimeMs > MAX_AGE_MS) await rm(directory, { recursive: true, force: true })
    }))
  }

  async latest(): Promise<FullDiagnosticCase | null> {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(error => {
      if (error.code === "ENOENT") return []
      throw error
    })
    const cases = await Promise.all(entries.filter(item => item.isDirectory() && CASE_ID.test(item.name))
      .map(item => this.load(item.name).catch(() => null)))
    return cases.filter(item => item !== null).filter(item => item.operation !== "diagnostic.prepare")
      .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
  }

  private archive(reportId: string): string {
    if (!CASE_ID.test(reportId)) throw new FullDiagnosticError("故障包编号无效。")
    return path.join(this.root, reportId, "case.zip")
  }

  async get(reportId: string): Promise<FullDiagnosticCase | null> {
    try { return await this.load(reportId) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
      throw error
    }
  }

  private async load(reportId: string): Promise<FullDiagnosticCase> {
    const archive = this.archive(reportId)
    const info = await stat(archive)
    const manifest = JSON.parse(await readFile(path.join(path.dirname(archive), "manifest.json"), "utf8")) as FullDiagnosticCase
    if (!info.isFile() || !Number.isFinite(manifest.createdAt) || Date.now() - manifest.createdAt * 1000 > MAX_AGE_MS ||
      manifest.reportId !== reportId || manifest.sizeBytes !== info.size) throw new FullDiagnosticError("故障包已过期或未生成完整。")
    return { ...manifest, uploadLimitBytes: FULL_CASE_UPLOAD_LIMIT }
  }

  async save(reportId: string, target: string): Promise<void> {
    await this.load(reportId)
    await copyFile(this.archive(reportId), target)
    if (process.platform !== "win32") await chmod(target, 0o600)
  }

  async send(reportId: string): Promise<{ reportId: string; retentionDays: number }> {
    const item = await this.load(reportId)
    if (item.sizeBytes > FULL_CASE_UPLOAD_LIMIT) throw new FullDiagnosticError("故障包超过上传大小上限。可保存到本机，把完整文件交给维护者。")
    if (!this.endpoint) throw new FullDiagnosticError("当前未配置故障包接收服务，可先保存到本机。")
    const uploadUrl = new URL(this.endpoint)
    const suffix = "/v1/reports"
    if (!uploadUrl.pathname.endsWith(suffix)) throw new FullDiagnosticError("故障包接收地址无效。")
    uploadUrl.pathname = uploadUrl.pathname.slice(0, -suffix.length) + "/v1/full-reports"
    const bytes = await readFile(this.archive(reportId))
    const checksum = createHash("sha256").update(bytes).digest("hex")
    const response = await fetch(uploadUrl, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(60_000),
      headers: { "Content-Type": "application/zip", "X-Report-Id": reportId },
      body: new Uint8Array(bytes),
    }).catch(() => { throw new FullDiagnosticError("连接故障包接收服务失败。可以重试或保存到本机。") })
    const result = await response.json().catch(() => null)
    if (response.status !== 202 || result?.ok !== true || result.report_id !== reportId || result.sha256 !== checksum || result.retention_days !== 30) {
      throw new FullDiagnosticError(`故障包未确认入库（HTTP ${response.status}）。可以重试或保存到本机。`)
    }
    return { reportId, retentionDays: 30 }
  }
}
