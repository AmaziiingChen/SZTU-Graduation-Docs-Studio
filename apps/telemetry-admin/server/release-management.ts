import { execFile } from "node:child_process"
import { createHash, createPublicKey } from "node:crypto"
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const MAX_BODY_BYTES = 64 * 1024
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export type ReleaseStatus = {
  keyReady: boolean
  publicKeyPem: string | null
  releaseDirectory: string
  manifestReady: boolean
  datePolicyReady: boolean
  dateRules: Array<{ college: string; start_date: string; end_date: string }>
}

type ReleaseRequest = {
  version: string
  artifacts: Array<{ platform: "darwin" | "win32" | "linux"; arch: "arm64" | "x64"; filePath: string; url: string }>
  control: Record<string, unknown>
}

function releaseDirectory(environment: Record<string, string>): string {
  return path.resolve(
    environment.SZTU_RELEASE_DIRECTORY || path.join(os.homedir(), ".sztu-docs-release"),
  )
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export async function getReleaseStatus(
  environment: Record<string, string>,
): Promise<ReleaseStatus> {
  const directory = releaseDirectory(environment)
  const publicKeyPath = path.join(directory, "update-public.pem")
  const datePolicyPath = path.join(directory, "midterm-date-policy.json")
  let dateRules: ReleaseStatus["dateRules"] = []
  if (await exists(datePolicyPath)) {
    try {
      const signed = JSON.parse(await readFile(datePolicyPath, "utf8")) as { payload?: { rules?: ReleaseStatus["dateRules"] } }
      if (Array.isArray(signed.payload?.rules)) dateRules = signed.payload.rules
    } catch { /* A damaged local file must not block the form. */ }
  }
  return {
    keyReady:
      (await exists(path.join(directory, "update-private.pem"))) &&
      (await exists(publicKeyPath)),
    publicKeyPem: (await exists(publicKeyPath)) ? await readFile(publicKeyPath, "utf8") : null,
    releaseDirectory: directory,
    manifestReady: await exists(path.join(directory, "manifest.json")),
    datePolicyReady: await exists(datePolicyPath),
    dateRules,
  }
}

export async function initializeReleaseKeys(
  environment: Record<string, string>,
  repositoryRoot: string,
): Promise<ReleaseStatus> {
  const directory = releaseDirectory(environment)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await execFileAsync(process.execPath, [
    path.join(repositoryRoot, "scripts/generate_update_signing_key.mjs"),
    "--output-directory",
    directory,
  ])
  return getReleaseStatus(environment)
}

function parseReleaseRequest(value: unknown): ReleaseRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("发布信息格式无效。")
  }
  const raw = value as Record<string, unknown>
  if (
    typeof raw.version !== "string" ||
    !SEMVER_PATTERN.test(raw.version) ||
    !Array.isArray(raw.artifacts) ||
    raw.artifacts.length > 6 ||
    !raw.control ||
    typeof raw.control !== "object" ||
    Array.isArray(raw.control)
  ) {
    throw new Error("请填写有效版本和发布策略。")
  }
  const artifacts = raw.artifacts.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("安装包信息无效。")
    }
    const item = value as Record<string, unknown>
    if (
      !["darwin", "win32", "linux"].includes(String(item.platform)) ||
      !["arm64", "x64"].includes(String(item.arch)) ||
      typeof item.filePath !== "string" ||
      !path.isAbsolute(item.filePath) ||
      typeof item.url !== "string"
    ) {
      throw new Error("安装包必须包含平台、架构、绝对路径和 HTTPS 地址。")
    }
    const url = new URL(item.url)
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
      throw new Error("安装包地址必须是无凭据、无片段的 HTTPS 地址。")
    }
    return item as ReleaseRequest["artifacts"][number]
  })
  return { version: raw.version, artifacts, control: raw.control as Record<string, unknown> }
}

export async function createReleaseManifest(
  input: unknown,
  environment: Record<string, string>,
  repositoryRoot: string,
): Promise<{ manifestPath: string; version: string }> {
  const request = parseReleaseRequest(input)
  const directory = releaseDirectory(environment)
  const privateKeyPath = path.join(directory, "update-private.pem")
  const manifestPath = path.join(directory, "manifest.json")
  const controlPath = path.join(directory, "release-control.json")
  if (!(await exists(privateKeyPath))) throw new Error("请先初始化发布密钥。")
  for (const artifact of request.artifacts) {
    const descriptor = await stat(artifact.filePath)
    if (!descriptor.isFile()) throw new Error(`安装包不是普通文件：${artifact.filePath}`)
  }
  await writeFile(controlPath, `${JSON.stringify(request.control, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  })
  const arguments_ = [
    path.join(repositoryRoot, "scripts/create_update_manifest.mjs"),
    "--version",
    request.version,
    "--private-key",
    privateKeyPath,
    "--control",
    controlPath,
    "--output",
    manifestPath,
  ]
  for (const artifact of request.artifacts) {
    arguments_.push(
      "--artifact",
      `${artifact.platform}|${artifact.arch}|${artifact.filePath}|${artifact.url}`,
    )
  }
  await execFileAsync(process.execPath, arguments_, { maxBuffer: 1024 * 1024 })
  return { manifestPath, version: request.version }
}

export async function createMidtermDatePolicy(
  input: unknown,
  environment: Record<string, string>,
  repositoryRoot: string,
): Promise<{ policyPath: string; ruleCount: number }> {
  if (!Array.isArray(input) || input.length > 50) throw new Error("日期规则最多 50 条。")
  const directory = releaseDirectory(environment)
  const privateKeyPath = path.join(directory, "update-private.pem")
  if (!(await exists(privateKeyPath))) throw new Error("请先初始化发布密钥。")
  const productionConfig = JSON.parse(await readFile(path.join(repositoryRoot, "config/remote-services.production.json"), "utf8")) as { update_public_key_pem?: string }
  const localPublicKey = createPublicKey(await readFile(privateKeyPath, "utf8")).export({ type: "spki", format: "der" })
  const pinnedPublicKey = createPublicKey(productionConfig.update_public_key_pem ?? "").export({ type: "spki", format: "der" })
  if (!localPublicKey.equals(pinnedPublicKey)) throw new Error("本机发布密钥与桌面客户端信任的公钥不一致。")
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const rulesPath = path.join(directory, "midterm-date-rules.json")
  const policyPath = path.join(directory, "midterm-date-policy.json")
  await writeFile(rulesPath, `${JSON.stringify(input, null, 2)}\n`, { mode: 0o600 })
  await execFileAsync(process.execPath, [
    path.join(repositoryRoot, "scripts/create_midterm_date_policy.mjs"),
    "--rules", rulesPath,
    "--private-key", privateKeyPath,
    "--output", policyPath,
  ], { maxBuffer: 1024 * 1024 })
  return { policyPath, ruleCount: input.length }
}

export async function publishMidtermDatePolicy(
  input: unknown,
  environment: Record<string, string>,
  repositoryRoot: string,
): Promise<{ policyPath: string; cloudPath: string; ruleCount: number }> {
  const created = await createMidtermDatePolicy(input, environment, repositoryRoot)
  const config = JSON.parse(await readFile(path.join(repositoryRoot, "config/remote-services.production.json"), "utf8")) as { midterm_date_policy_url?: string }
  if (!config.midterm_date_policy_url) throw new Error("正式客户端尚未配置日期规则地址。")
  const url = new URL(config.midterm_date_policy_url)
  const cloudPath = url.pathname.replace(/^\/+/, "")
  if (url.protocol !== "https:" || !cloudPath.endsWith("/midterm-date-policy.json") || url.search || url.hash) {
    throw new Error("日期规则云端路径无效。")
  }
  const envId = environment.CLOUDBASE_ENV_ID || "amazingapp-d5giro9ac73398410"
  try {
    await execFileAsync("tcb", [
      "hosting", "deploy", created.policyPath, cloudPath,
      "--env-id", envId, "--safe", "--verify", "--json",
    ], { timeout: 120_000, maxBuffer: 1024 * 1024 })
    const listed = await execFileAsync("tcb", [
      "hosting", "list", cloudPath, "--env-id", envId, "--json",
    ], { timeout: 30_000, maxBuffer: 1024 * 1024 })
    if (!listed.stdout.includes("midterm-date-policy.json")) {
      throw new Error("云端列表未显示日期规则文件，请检查发布结果。")
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    if (/identity|authorize|login|登录|授权/i.test(detail)) {
      throw new Error("CloudBase 登录已失效。请在本机终端运行 tcb login 后重试发布。")
    }
    throw new Error(`日期规则云端发布未完成：${detail}`)
  }
  const localHash = createHash("sha256").update(await readFile(created.policyPath)).digest("hex")
  try {
    const response = await fetch(url, { method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    if (Number(response.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) throw new Error("远端文件超过大小上限。")
    const remoteBytes = Buffer.from(await response.arrayBuffer())
    if (remoteBytes.length > 64 * 1024 || createHash("sha256").update(remoteBytes).digest("hex") !== localHash) {
      throw new Error("远端内容与本地签名文件不一致。")
    }
  } catch (error) {
    throw new Error(`签名文件已上传，但公网地址尚未验证一致：${error instanceof Error ? error.message : String(error)}`)
  }
  return { ...created, cloudPath }
}

export async function readJsonBody(request: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk)
      ? chunk
      : typeof chunk === "string"
        ? Buffer.from(chunk)
        : Buffer.from(chunk as Uint8Array)
    size += bytes.length
    if (size > MAX_BODY_BYTES) throw new Error("请求内容过大。")
    chunks.push(bytes)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
}
