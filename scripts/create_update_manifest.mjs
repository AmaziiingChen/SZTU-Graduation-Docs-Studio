#!/usr/bin/env node

import { createHash, createPrivateKey, sign } from "node:crypto"
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const PLATFORMS = new Set(["darwin", "win32", "linux"])
const ARCHES = new Set(["arm64", "x64"])

function exactKeys(value, keys) {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value)
}

const INTERNAL_NOTICE_TARGETS = new Set(["guide", "release-notes", "faq", "settings"])

export function validateNotice(value) {
  const keys = [
    "id",
    "title",
    "body",
    "image_url",
    "severity",
    "starts_at",
    "ends_at",
    "min_version",
    "max_version",
    "actions",
  ]
  if (
    !exactKeys(value, keys) ||
    typeof value.id !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value.id) ||
    typeof value.title !== "string" ||
    value.title.trim().length < 1 ||
    value.title.length > 80 ||
    typeof value.body !== "string" ||
    value.body.trim().length < 1 ||
    value.body.length > 4_000 ||
    !["info", "important", "critical"].includes(value.severity) ||
    typeof value.starts_at !== "string" ||
    !Number.isFinite(Date.parse(value.starts_at)) ||
    !(
      value.ends_at === null ||
      (typeof value.ends_at === "string" && Number.isFinite(Date.parse(value.ends_at)))
    ) ||
    !(
      value.min_version === null ||
      (typeof value.min_version === "string" && SEMVER_PATTERN.test(value.min_version))
    ) ||
    !(
      value.max_version === null ||
      (typeof value.max_version === "string" && SEMVER_PATTERN.test(value.max_version))
    ) ||
    !Array.isArray(value.actions) ||
    value.actions.length > 4
  ) {
    throw new Error("消息格式无效。")
  }
  if (value.ends_at !== null && new Date(value.ends_at) <= new Date(value.starts_at)) {
    throw new Error("消息结束时间必须晚于开始时间。")
  }
  if (value.image_url !== null) {
    const parsed = new URL(value.image_url)
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new Error("消息图片必须是无凭据的 HTTPS 地址。")
    }
  }
  const actionIds = new Set()
  for (const action of value.actions) {
    if (
      !exactKeys(action, ["id", "label", "kind", "target"]) ||
      typeof action.id !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(action.id) ||
      actionIds.has(action.id) ||
      typeof action.label !== "string" ||
      action.label.trim().length < 1 ||
      action.label.length > 40 ||
      !["external", "internal"].includes(action.kind) ||
      typeof action.target !== "string"
    ) {
      throw new Error("消息按钮格式无效。")
    }
    actionIds.add(action.id)
    if (action.kind === "internal") {
      if (!INTERNAL_NOTICE_TARGETS.has(action.target)) {
        throw new Error(`消息按钮目标不受支持：${action.target}`)
      }
      continue
    }
    const parsed = new URL(action.target)
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new Error("消息按钮外链必须是无凭据的 HTTPS 地址。")
    }
  }
  return value
}

export function validateReleaseControl(value, schemaVersion = "2.0") {
  const keys = [
    "update_policy",
    "minimum_supported_version",
    "service_status",
    "help_url",
    "announcement",
    ...(schemaVersion === "3.0" ? ["notices"] : []),
  ]
  if (
    !exactKeys(value, keys) ||
    !["optional", "recommended", "required"].includes(value.update_policy) ||
    !["normal", "maintenance", "retired"].includes(value.service_status) ||
    !(value.minimum_supported_version === null ||
      (typeof value.minimum_supported_version === "string" &&
        SEMVER_PATTERN.test(value.minimum_supported_version))) ||
    !(value.help_url === null || typeof value.help_url === "string")
  ) {
    throw new Error("远程发布策略格式无效。")
  }
  if (schemaVersion === "3.0") {
    if (!Array.isArray(value.notices) || value.notices.length > 20) {
      throw new Error("消息列表无效。")
    }
    const ids = new Set()
    for (const notice of value.notices) {
      validateNotice(notice)
      if (ids.has(notice.id)) throw new Error(`消息 id 重复：${notice.id}`)
      ids.add(notice.id)
    }
  }
  if (value.help_url !== null) {
    const parsed = new URL(value.help_url)
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
      throw new Error("使用说明地址必须是无凭据、无片段的 HTTPS 地址。")
    }
  }
  if (value.announcement !== null) {
    const announcementKeys = [
      "id",
      "title",
      "body",
      "severity",
      "starts_at",
      "ends_at",
      "dismissible",
    ]
    const item = value.announcement
    if (
      !exactKeys(item, announcementKeys) ||
      typeof item.id !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(item.id) ||
      typeof item.title !== "string" ||
      item.title.trim().length < 1 ||
      item.title.length > 80 ||
      typeof item.body !== "string" ||
      item.body.trim().length < 1 ||
      item.body.length > 1_000 ||
      !["info", "important", "critical"].includes(item.severity) ||
      typeof item.starts_at !== "string" ||
      !Number.isFinite(Date.parse(item.starts_at)) ||
      !(item.ends_at === null ||
        (typeof item.ends_at === "string" && Number.isFinite(Date.parse(item.ends_at)))) ||
      typeof item.dismissible !== "boolean"
    ) {
      throw new Error("公告格式无效。")
    }
    if (item.ends_at !== null && new Date(item.ends_at) <= new Date(item.starts_at)) {
      throw new Error("公告结束时间必须晚于开始时间。")
    }
  }
  return value
}

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
    else if (name === "--control") values.control = value
    else if (name === "--schema") values.schema = value
    else if (name === "--notices") values.notices = value
    else throw new Error(`不支持的参数：${name}`)
  }
  if (!values.version || !SEMVER_PATTERN.test(values.version)) {
    throw new Error("--version 必须是语义化版本号。")
  }
  if (!values.privateKey || !values.output || (!values.control && values.artifacts.length === 0)) {
    throw new Error("必须提供 --private-key、--output，并提供 --control 或至少一个 --artifact。")
  }
  if (values.schema !== undefined && !["2.0", "3.0"].includes(values.schema)) {
    throw new Error("--schema 只支持 2.0 或 3.0。")
  }
  if ((values.schema || values.notices) && !values.control) {
    throw new Error("--schema 与 --notices 只能与 --control 一起使用。")
  }
  if (values.notices && values.schema === "2.0") {
    throw new Error("--notices 需要 --schema 3.0。")
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
    schema_version: input.control ? (input.schemaVersion ?? "2.0") : "1.0",
    channel: "stable",
    version: input.version,
    published_at: input.publishedAt,
    artifacts,
    ...(input.control
      ? { control: validateReleaseControl(input.control, input.schemaVersion ?? "2.0") }
      : {}),
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
  const control = arguments_.control
    ? JSON.parse(await readFile(path.resolve(arguments_.control), "utf8"))
    : undefined
  const schemaVersion = arguments_.schema ?? (control ? "2.0" : undefined)
  if (control && arguments_.notices) {
    control.notices = JSON.parse(await readFile(path.resolve(arguments_.notices), "utf8"))
  }
  if (control && schemaVersion === "3.0" && !Array.isArray(control.notices)) {
    control.notices = []
  }
  const manifest = await createSignedManifest({
    version: arguments_.version,
    publishedAt: arguments_.publishedAt,
    privateKeyPath: path.resolve(arguments_.privateKey),
    artifacts,
    control,
    schemaVersion,
  })
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  })
  await chmod(outputPath, 0o600)
  process.stdout.write(`已生成签名更新清单：${outputPath}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "生成失败"}\n`)
    process.exitCode = 1
  })
}
