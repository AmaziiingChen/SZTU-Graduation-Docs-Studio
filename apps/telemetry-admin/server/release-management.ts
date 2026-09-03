import { execFile } from "node:child_process"
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
  return {
    keyReady:
      (await exists(path.join(directory, "update-private.pem"))) &&
      (await exists(publicKeyPath)),
    publicKeyPem: (await exists(publicKeyPath)) ? await readFile(publicKeyPath, "utf8") : null,
    releaseDirectory: directory,
    manifestReady: await exists(path.join(directory, "manifest.json")),
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
