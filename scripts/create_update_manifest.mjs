#!/usr/bin/env node

import { createHash, createPrivateKey, sign } from "node:crypto"
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const PLATFORMS = new Set(["darwin", "win32", "linux"])
const ARCHES = new Set(["arm64", "x64"])

export function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value)
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("JSON contains a non-finite number.")
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (!value || typeof value !== "object") throw new Error("Value is not JSON serializable.")
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`
}

function parseArguments(argv) {
  const values = { artifacts: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`参数 ${name ?? ""} 缺少值。`)
    }
    index += 1
    if (name === "--artifact") values.artifacts.push(value)
    else if (name === "--version") values.version = value
    else if (name === "--published-at") values.publishedAt = value
    else if (name === "--private-key") values.privateKey = value
    else if (name === "--output") values.output = value
    else throw new Error(`不支持的参数：${name}`)
  }
  if (!values.version || !SEMVER_PATTERN.test(values.version)) {
    throw new Error("--version 必须是语义化版本号。")
  }
  if (!values.privateKey || !values.output || values.artifacts.length === 0) {
    throw new Error("必须提供 --private-key、--output 和至少一个 --artifact。")
  }
  const publishedAt = values.publishedAt ?? new Date().toISOString()
  if (!Number.isFinite(Date.parse(publishedAt))) {
    throw new Error("--published-at 必须是有效的 ISO 日期时间。")
  }
  return { ...values, publishedAt }
}

function parseArtifact(value) {
  const parts = value.split("|")
  if (parts.length !== 4) {
    throw new Error("--artifact 格式必须为 platform|arch|file|https-url。")
  }
  const [platform, arch, filePath, url] = parts
  if (!PLATFORMS.has(platform) || !ARCHES.has(arch)) {
    throw new Error("artifact 平台或架构不受支持。")
  }
  const parsedUrl = new URL(url)
  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.hash
  ) {
    throw new Error("artifact URL 必须是无凭据、无片段的 HTTPS 地址。")
  }
  return { platform, arch, filePath: path.resolve(filePath), url: parsedUrl.toString() }
}

export async function createSignedManifest(input) {
  if (!SEMVER_PATTERN.test(input.version)) throw new Error("Invalid version.")
  const artifacts = []
  for (const item of input.artifacts) {
    const descriptor = await stat(item.filePath)
    if (!descriptor.isFile() || descriptor.size < 1 || descriptor.size > 1024 ** 3) {
      throw new Error(`更新文件无效：${item.filePath}`)
    }
    const bytes = await readFile(item.filePath)
    artifacts.push({
      platform: item.platform,
      arch: item.arch,
      url: item.url,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size_bytes: bytes.length,
    })
  }
  const payload = {
    schema_version: "1.0",
    channel: "stable",
    version: input.version,
    published_at: input.publishedAt,
    artifacts,
  }
  const privateKey = createPrivateKey(await readFile(input.privateKeyPath, "utf8"))
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("发布私钥必须是 Ed25519 私钥。")
  }
  const signature = sign(
    null,
    Buffer.from(canonicalJson(payload), "utf8"),
    privateKey,
  ).toString("base64")
  return { payload, signature }
}

export async function main(argv = process.argv.slice(2)) {
  const arguments_ = parseArguments(argv)
  const artifacts = arguments_.artifacts.map(parseArtifact)
  const outputPath = path.resolve(arguments_.output)
  const manifest = await createSignedManifest({
    version: arguments_.version,
    publishedAt: arguments_.publishedAt,
    privateKeyPath: path.resolve(arguments_.privateKey),
    artifacts,
  })
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  })
  await chmod(outputPath, 0o600)
  process.stdout.write(`已生成签名更新清单：${outputPath}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "生成失败"}\n`)
    process.exitCode = 1
  })
}
