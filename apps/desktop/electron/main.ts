import { FullDiagnosticError, FullDiagnostics } from "./full-diagnostics.js"
import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { diagnosticContext, documentStructure, type DiagnosticContext } from "./diagnostic-context.js"
import { createHash, randomUUID } from "node:crypto"
import { lstat, mkdir, readFile, realpath, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  session,
  shell,
  Tray,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from "electron"

import {
  SidecarClient,
  SidecarError,
  type SidecarMethod,
} from "./sidecar-client.js"
import {
  DiagnosticService,
  stableDiagnosticErrorCode,
  type DiagnosticEnvironmentInput,
  type DiagnosticOperation,
} from "./diagnostics.js"
import { loadRemoteServicesConfig } from "./remote-services-config.js"
import {
  parseTelemetryUsageEvent,
  TelemetryService,
} from "./telemetry.js"
import { UpdateService, type UpdateStatus } from "./update-service.js"
import { MidtermDatePolicyService, type MidtermDatePolicyStatus } from "./midterm-date-policy.js"

import { developmentConfig } from "./development-config.js"
import { privatePreviewRoot } from "./preview-path.js"
import { CloseCoordinator } from "./close-coordinator.js"
import { EXPORT_RUN_TIMEOUT_MS, normalizeExportRunError } from "./export-run.js"
import { SidecarChannels } from "./sidecar-channels.js"
import { checkThesisTemplateResource, downloadThesisTemplate, ThesisTemplateError } from "./thesis-template.js"

const localDevelopment = developmentConfig(app.isPackaged)
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
const developmentServerUrl = localDevelopment.url

let mainWindow: BrowserWindow | undefined
let tray: Tray | undefined
let sidecar: SidecarChannels | undefined
let telemetry: TelemetryService | undefined
let updateService: UpdateService | undefined
let midtermDatePolicyService: MidtermDatePolicyService | undefined
let diagnostics: DiagnosticService | undefined
let fullDiagnostics: FullDiagnostics | undefined
let remoteServicesStarted = false
let shutdownStarted = false
let quitApproved = false
let shutdownComplete = false
const approvedWindowClosures = new Set<number>()
const closeCoordinator = new CloseCoordinator({
  requestSave: (windowId, requestId) => {
    const window = BrowserWindow.fromId(windowId)
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
      throw new Error("The editing window is no longer available.")
    }
    window.webContents.send("sztu:close-request", requestId)
  },
  onSaved: (windowId, intent) => {
    if (intent === "quit") {
      quitApproved = true
      setImmediate(() => app.quit())
    } else {
      approvedWindowClosures.add(windowId)
      setImmediate(() => BrowserWindow.fromId(windowId)?.close())
    }
  },
})
const approvedExportDirectories = new Set<string>()
const activeCancellationFiles = new Map<string, string>()
const activePreviewCancellationFiles = new Map<string, string>()
const TOOL_LINKS = {
  xmind: "https://xmind.com/",
  "draw-io": "https://app.diagrams.net/",
  simpletex: "https://www.simpletex.cn/ai/latex_ocr",
  seekall: "https://seekall.ai/",
  vcaptions:
    "https://chromewebstore.google.com/detail/vcaptions-%E2%80%93-video-caption/bciglihaegkdhoogebcdblfhppoilclp",
  voyager: "https://voyager.nagi.fun/",
  "immersive-translate": "https://immersivetranslate.com/",
  easyscholar: "https://www.easyscholar.cc/",
  tabbit: "https://www.tabbit.com/?lang=zh",
  deepl: "https://www.deepl.com/translator",
  islide: "https://www.islide.cc/",
  zotero: "https://www.zotero.org/",
  metaso: "https://metaso.cn/",
  perplexity: "https://www.perplexity.ai/",
  deepseek: "https://chat.deepseek.com/",
  doubao: "https://www.doubao.com/",
  qianwen: "https://www.qianwen.com/",
  gemini: "https://gemini.google.com/",
  mactex: "https://tug.org/mactex/",
  texlive: "https://tug.org/texlive/",
  poppler: "https://poppler.freedesktop.org/",
  "homebrew-poppler": "https://formulae.brew.sh/formula/poppler",
  "font-book-help":
    "https://support.apple.com/guide/font-book/install-and-validate-fonts-fntbk1000/mac",
  "windows-font-help":
    "https://support.microsoft.com/office/add-a-font-b7c5f17c-4426-4b53-967f-455339c564c1",
  "wps-office": "https://www.wps.cn/",
} as const

type ToolLinkId = keyof typeof TOOL_LINKS

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[]
type JsonObject = { [key: string]: JsonValue }

type BridgeError = {
  code: string
  message: string
  details?: Record<string, unknown>
}

type BridgeResponse<T> =
  | { ok: true; result: T }
  | { ok: false; error: BridgeError }

const RESOURCE_ID_PATTERN = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_JSON_DEPTH = 20
const MAX_JSON_COLLECTION_SIZE = 10_000
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const MANAGED_IMAGE_NAME_PATTERN = /^([a-f0-9]{64})\.(png|jpe?g)$/
const MAX_IMAGE_ASSET_BYTES = 20 * 1024 * 1024
const MAX_CLIPBOARD_TEXT_LENGTH = 2_000_000

protocol.registerSchemesAsPrivileged([
  {
    scheme: "sztu-asset",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
])

class IpcValidationError extends Error {
  readonly code = "INVALID_PARAMS"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function assertExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional])
  if (!required.every((key) => key in value) || !Object.keys(value).every((key) => allowed.has(key))) {
    throw new IpcValidationError("请求参数不完整或包含不支持的字段。")
  }
}

function assertText(
  value: unknown,
  field: string,
  maximum: number,
  required = true,
): asserts value is string | null | undefined {
  if (!required && (value === undefined || value === null)) return
  if (typeof value !== "string" || (required && value.trim().length === 0) || value.length > maximum) {
    throw new IpcValidationError(`${field}格式无效。`)
  }
}

function assertResourceId(value: unknown, field = "文档编号"): asserts value is string {
  if (typeof value !== "string" || !RESOURCE_ID_PATTERN.test(value)) {
    throw new IpcValidationError(`${field}格式无效。`)
  }
}

function assertRequestId(value: unknown, field = "任务编号"): asserts value is string {
  if (typeof value !== "string" || !REQUEST_ID_PATTERN.test(value)) {
    throw new IpcValidationError(`${field}格式无效。`)
  }
}

function assertDocumentListCursor(value: unknown): void {
  if (!isRecord(value)) throw new IpcValidationError("文档列表游标无效。")
  assertExactKeys(value, ["updated_at", "id"])
  assertResourceId(value.id, "文档编号")
  assertText(value.updated_at, "文档更新时间", 100)
  if (typeof value.updated_at !== "string" || !Number.isFinite(Date.parse(value.updated_at))) {
    throw new IpcValidationError("文档列表分页信息无效，请重新加载。")
  }
}

function cancellationPath(requestId: string): string {
  const directory = path.resolve(app.getPath("userData"), "cancellations")
  const marker = path.resolve(directory, `${requestId}.cancel`)
  if (!marker.startsWith(`${directory}${path.sep}`)) {
    throw new IpcValidationError("取消请求路径无效。")
  }
  return marker
}

function imageAssetDirectory(): string {
  return path.resolve(app.getPath("userData"), "document-assets")
}

function detectImageMime(bytes: Buffer): "image/png" | "image/jpeg" | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) return "image/png"
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg"
  }
  return null
}

function decodeClipboardPng(value: unknown): Buffer {
  const prefix = "data:image/png;base64,"
  if (typeof value !== "string" || !value.startsWith(prefix)) {
    throw new IpcValidationError("剪贴板图片必须是 PNG 数据。")
  }
  const encoded = value.slice(prefix.length)
  if (!encoded || encoded.length > MAX_IMAGE_ASSET_BYTES * 2 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new IpcValidationError("剪贴板 PNG 数据无效或过大。")
  }
  const bytes = Buffer.from(encoded, "base64")
  if (bytes.length > MAX_IMAGE_ASSET_BYTES || detectImageMime(bytes) !== "image/png") {
    throw new IpcValidationError("请复制小于 20 MiB 的 PNG 图片。")
  }
  return bytes
}

async function readManagedImageAsset(fileName: string): Promise<
  | { status: 200; bytes: Buffer; mimeType: "image/png" | "image/jpeg" }
  | { status: 403 | 404 | 422 }
> {
  const match = fileName.match(MANAGED_IMAGE_NAME_PATTERN)
  if (!match) return { status: 404 }
  const directory = imageAssetDirectory()
  const target = path.resolve(directory, fileName)
  if (!target.startsWith(`${directory}${path.sep}`)) return { status: 403 }
  try {
    const fileStat = await lstat(target)
    if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size > MAX_IMAGE_ASSET_BYTES) {
      return { status: 403 }
    }
    const bytes = await readFile(target)
    const digest = createHash("sha256").update(bytes).digest("hex")
    const mimeType = detectImageMime(bytes)
    if (digest !== match[1] || !mimeType) return { status: 422 }
    return { status: 200, bytes, mimeType }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: 404 }
    throw error
  }
}

async function registerAssetProtocol(): Promise<void> {
  protocol.handle("sztu-asset", async (request) => {
    const url = new URL(request.url)
    if (url.hostname !== "asset") return new Response("Not found", { status: 404 })
    const fileName = decodeURIComponent(url.pathname.replace(/^\//, ""))
    const asset = await readManagedImageAsset(fileName)
    if (asset.status !== 200) return new Response("Asset unavailable", { status: asset.status })
    return new Response(Uint8Array.from(asset.bytes), {
      headers: { "Content-Type": asset.mimeType, "Cache-Control": "private, max-age=31536000, immutable" },
    })
  })
}

async function removeCancellationMarker(marker: string): Promise<void> {
  try {
    await unlink(marker)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
}

async function readVerifiedPreviewPage(
  absolutePath: string,
  expectedRoot: string,
  expectedSha256: string,
  expectedSize: number,
): Promise<string> {
  const target = path.resolve(absolutePath)
  if (target !== absolutePath || target === expectedRoot || !target.startsWith(`${expectedRoot}${path.sep}`)) {
    throw new SidecarError("INVALID_SIDECAR_RESULT", "Sidecar preview path is outside the private cache.")
  }
  const stat = await lstat(target)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expectedSize || stat.size > 12_000_000) {
    throw new SidecarError("INVALID_SIDECAR_RESULT", "Sidecar preview page metadata is invalid.")
  }
  const resolved = await realpath(target)
  if (resolved !== target || !resolved.startsWith(`${expectedRoot}${path.sep}`)) {
    throw new SidecarError("INVALID_SIDECAR_RESULT", "Sidecar preview page failed path verification.")
  }
  const bytes = await readFile(target)
  if (
    bytes.length !== expectedSize ||
    bytes.length < 8 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    createHash("sha256").update(bytes).digest("hex") !== expectedSha256
  ) {
    throw new SidecarError("INVALID_SIDECAR_RESULT", "Sidecar preview page failed content verification.")
  }
  return `data:image/png;base64,${bytes.toString("base64")}`
}

async function verifyPreviewPdf(
  absolutePath: string,
  expectedRoot: string,
  expectedSha256: string,
  expectedSize: number,
): Promise<void> {
  const target = path.resolve(absolutePath)
  if (target !== absolutePath || target === expectedRoot || !target.startsWith(`${expectedRoot}${path.sep}`)) {
    throw new SidecarError("INVALID_SIDECAR_RESULT", "Sidecar preview PDF is outside the private cache.")
  }
  const stat = await lstat(target)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expectedSize || stat.size > 50_000_000) {
    throw new SidecarError("INVALID_SIDECAR_RESULT", "Sidecar preview PDF metadata is invalid.")
  }
  const resolved = await realpath(target)
  const bytes = await readFile(target)
  if (
    resolved !== target ||
    !resolved.startsWith(`${expectedRoot}${path.sep}`) ||
    bytes.length !== expectedSize ||
    bytes.subarray(0, 5).toString("ascii") !== "%PDF-" ||
    createHash("sha256").update(bytes).digest("hex") !== expectedSha256
  ) {
    throw new SidecarError("INVALID_SIDECAR_RESULT", "Sidecar preview PDF failed content verification.")
  }
}

function assertJsonValue(value: unknown, depth = 0): asserts value is JsonValue {
  if (depth > MAX_JSON_DEPTH) {
    throw new IpcValidationError("文档内容嵌套层级超出限制。")
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new IpcValidationError("文档内容包含无效数值。")
    return
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_COLLECTION_SIZE) throw new IpcValidationError("文档内容数量超出限制。")
    for (const item of value) assertJsonValue(item, depth + 1)
    return
  }
  if (!isRecord(value)) throw new IpcValidationError("文档内容格式无效。")
  const entries = Object.entries(value)
  if (entries.length > MAX_JSON_COLLECTION_SIZE) throw new IpcValidationError("文档内容数量超出限制。")
  for (const [key, item] of entries) {
    if (!key || key.length > 128 || ["__proto__", "constructor", "prototype"].includes(key)) {
      throw new IpcValidationError("文档内容包含无效字段。")
    }
    assertJsonValue(item, depth + 1)
  }
}

function assertThesisTitle(
  value: unknown,
  field: string,
): asserts value is JsonValue[] | null {
  if (value === null) return
  if (!Array.isArray(value) || value.length > 1) {
    throw new IpcValidationError(`${field}仅支持一个段落。`)
  }
  assertJsonValue(value)
  if (JSON.stringify(value).length > 20_000) {
    throw new IpcValidationError(`${field}内容超出长度限制。`)
  }
}

function assertProfile(value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new IpcValidationError("学生档案格式无效。")
  assertExactKeys(
    value,
    ["full_name", "student_number", "college", "major"],
    [
      "id",
      "class_name",
      "advisor_name",
      "advisor_title",
      "graduation_cohort",
      "thesis_title",
      "thesis_title_en",
    ],
  )
  if (value.id !== undefined) assertResourceId(value.id, "学生档案编号")
  assertText(value.full_name, "姓名", 100)
  assertText(value.student_number, "学号", 64)
  assertText(value.college, "学院", 200)
  assertText(value.major, "专业", 200)
  assertText(value.class_name, "班级", 100, false)
  assertText(value.advisor_name, "指导教师", 100, false)
  assertText(value.advisor_title, "指导教师职称", 100, false)
  assertText(value.graduation_cohort, "毕业届别", 20, false)
  if (value.thesis_title !== undefined && value.thesis_title !== null) {
    assertThesisTitle(value.thesis_title, "论文题目")
  }
  assertText(value.thesis_title_en, "英文题目", 300, false)
}

function assertProfileDraft(value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new IpcValidationError("学生档案草稿格式无效。")
  const fields = [
    ["full_name", 100, "姓名"],
    ["student_number", 64, "学号"],
    ["college", 200, "学院"],
    ["major", 200, "专业"],
    ["class_name", 100, "班级"],
    ["advisor_name", 100, "指导教师"],
    ["advisor_title", 100, "指导教师职称"],
    ["graduation_cohort", 20, "毕业届别"],
  ] as const
  assertExactKeys(
    value,
    [...fields.map(([field]) => field), "thesis_title", "thesis_title_en"],
  )
  for (const [field, maximum, label] of fields) {
    const fieldValue = value[field]
    if (typeof fieldValue !== "string" || fieldValue.length > maximum) {
      throw new IpcValidationError(`${label}格式无效，最多支持 ${maximum} 个字符。`)
    }
  }
  assertThesisTitle(value.thesis_title, "论文题目")
  assertText(value.thesis_title_en, "英文题目", 300, false)
}

function assertDocument(value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new IpcValidationError("无法读取文档，请重新打开。")
  assertExactKeys(
    value,
    ["document_type", "template_version", "schema_version", "title"],
    ["profile_id", "source_document_id"],
  )
  if (value.profile_id !== undefined && value.profile_id !== null) {
    assertResourceId(value.profile_id, "学生档案编号")
  }
  if (
    value.document_type !== "proposal" &&
    value.document_type !== "task_book" &&
    value.document_type !== "midterm" &&
    value.document_type !== "thesis" &&
    value.document_type !== "advisor_review" &&
    value.document_type !== "reviewer_review" &&
    value.document_type !== "defense_record" &&
    value.document_type !== "grade_assessment"
  ) {
    throw new IpcValidationError("不支持当前文档类型。")
  }
  assertText(value.template_version, "模板版本", 64)
  assertText(value.schema_version, "文档格式版本", 64)
  assertText(value.title, "文档名称", 240)
  if (value.source_document_id !== undefined) {
    assertResourceId(value.source_document_id, "来源文档编号")
  }
}

function assertExportFormats(value: unknown): asserts value is Array<"docx" | "pdf" | "tex"> {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 3 ||
    new Set(value).size !== value.length ||
    !value.every((format) => format === "docx" || format === "pdf" || format === "tex")
  ) {
    throw new IpcValidationError("请选择 Word、PDF 或 LaTeX 中的至少一种格式。")
  }
}

function bridgeFailure(error: unknown): BridgeResponse<never> {
  if (error instanceof SidecarError || error instanceof IpcValidationError || error instanceof ThesisTemplateError || error instanceof FullDiagnosticError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error instanceof SidecarError && (error.details || error.diagnosticCaseId) ? {
          details: { ...error.details, ...(error.diagnosticCaseId ? { diagnostic_case_id: error.diagnosticCaseId } : {}) },
        } : {}),
      },
    }
  }
  return {
    ok: false,
    error: { code: "INTERNAL_ERROR", message: "本地工作台操作失败，请重试。" },
  }
}

async function runBridge<T>(operation: () => Promise<T> | T): Promise<BridgeResponse<T>> {
  try {
    return { ok: true, result: await operation() }
  } catch (error) {
    return bridgeFailure(error)
  }
}

function backendRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "backend")
    : path.resolve(app.getAppPath(), "../../backend")
}

function urlIsTrusted(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    if (app.isPackaged) {
      if (parsed.protocol !== "file:") return false
      const rendererRoot = path.resolve(moduleDirectory, "../dist")
      const targetPath = path.resolve(fileURLToPath(parsed))
      return (
        targetPath === rendererRoot ||
        targetPath.startsWith(`${rendererRoot}${path.sep}`)
      )
    }
    return parsed.origin === developmentServerUrl
  } catch {
    return false
  }
}

function senderIsTrusted(event: IpcMainInvokeEvent): boolean {
  const senderUrl = event.senderFrame?.url
  return senderUrl ? urlIsTrusted(senderUrl) : false
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!senderIsTrusted(event)) {
    throw new Error("IPC request rejected: untrusted sender.")
  }
}

function configureSession(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const connectSources = app.isPackaged
      ? "'self'"
      : `'self' ${developmentServerUrl} ${developmentServerUrl.replace("http:", "ws:")}`
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: sztu-asset:; connect-src ${connectSources}`,
        ],
      },
    })
  })
}

function desktopAssetPath(filename: string): string {
  return path.join(
    moduleDirectory,
    app.isPackaged ? "../dist" : "../public",
    filename,
  )
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow()
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createTray(): Tray | undefined {
  const iconName = process.platform === "darwin" ? "trayTemplate.png" : "app-icon.png"
  const trayImage = nativeImage.createFromPath(desktopAssetPath(iconName))
  if (trayImage.isEmpty()) {
    console.error("Tray icon resource is unavailable.")
    return undefined
  }
  if (process.platform === "darwin") {
    trayImage.setTemplateImage(true)
  }

  const nextTray = new Tray(trayImage)
  nextTray.setToolTip("SZTU文档工作台")
  nextTray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开 SZTU文档工作台", click: showMainWindow },
      { type: "separator" },
      { label: "退出", role: "quit" },
    ]),
  )
  if (process.platform !== "darwin") {
    nextTray.on("click", showMainWindow)
  }
  return nextTray
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: process.platform === "win32",
    icon: desktopAssetPath("app-icon.png"),
    webPreferences: {
      preload: path.join(moduleDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  // Keep native shortcuts; Windows users can reveal the hidden menu with Alt.
  if (process.platform === "win32") window.setMenuBarVisibility(false)

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (!urlIsTrusted(targetUrl)) {
      event.preventDefault()
    }
  })
  window.webContents.on("render-process-gone", (_event, details) => {
    const code =
      details.reason === "clean-exit"
        ? undefined
        : `RENDERER_${details.reason.replaceAll("-", "_").toUpperCase()}`
    diagnostics?.record(
      "renderer.process",
      details.reason === "clean-exit" ? "success" : "failure",
      0,
      code,
    )
  })

  window.once("ready-to-show", () => window.show())
  window.on("close", (event) => {
    if (quitApproved || approvedWindowClosures.delete(window.id)) return
    event.preventDefault()
    closeCoordinator.request(window.id, "window")
  })
  window.on("closed", () => {
    closeCoordinator.forget(window.id)
    approvedWindowClosures.delete(window.id)
    if (mainWindow === window) mainWindow = undefined
  })
  if (app.isPackaged) {
    void window.loadFile(path.join(moduleDirectory, "../dist/index.html"))
  } else {
    void window.loadURL(developmentServerUrl)
  }

  return window
}

async function startRemoteServices(): Promise<void> {
  // Configured telemetry starts by default; notice acknowledgement is historical metadata only.
  await telemetry?.start()
  if (remoteServicesStarted) return
  remoteServicesStarted = true
  updateService?.start()
  midtermDatePolicyService?.start()
}

async function initializeRemoteServices(): Promise<void> {
  let config = {}
  try {
    config = await loadRemoteServicesConfig({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
    })
  } catch {
    console.error("Remote services configuration was rejected.")
  }
  const resolved = config as Awaited<ReturnType<typeof loadRemoteServicesConfig>>
  fullDiagnostics = new FullDiagnostics(app.getPath("userData"), resolved.diagnosticEndpoint)
  await fullDiagnostics.removeExpired().catch(() => console.error("Could not remove expired local diagnostic cases."))
  diagnostics = new DiagnosticService({
    userDataPath: app.getPath("userData"),
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
    endpoint: resolved.diagnosticEndpoint,
  })
  await diagnostics.initialize()
  telemetry = new TelemetryService({
    userDataPath: app.getPath("userData"),
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
    endpoint: resolved.telemetryEndpoint,
  })
  await telemetry.initialize()
  updateService = new UpdateService({
    userDataPath: app.getPath("userData"),
    currentVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    manifestUrl: resolved.updateManifestUrl,
    publicKeyPem: resolved.updatePublicKeyPem,
    onOutcome: (outcome, version) => telemetry?.recordUpdate(outcome, version),
    onDiagnostic: (outcome, duration, code, context) => diagnostics?.record("diagnostic.step", outcome, duration, code, context),
  })
  updateService.onStatus((status) => {
    mainWindow?.webContents.send("sztu:update-status", status)
  })
  midtermDatePolicyService = new MidtermDatePolicyService({
    userDataPath: app.getPath("userData"),
    policyUrl: resolved.midtermDatePolicyUrl,
    publicKeyPem: resolved.updatePublicKeyPem,
  })
  midtermDatePolicyService.onStatus((status) => {
    mainWindow?.webContents.send("sztu:midterm-date-policy-status", status)
  })
  await midtermDatePolicyService.initialize()
  await startRemoteServices()
}

function privacyNoticeStatus() {
  if (!telemetry || !updateService) {
    throw new Error("Remote services are not initialized.")
  }
  const telemetryStatus = telemetry.getPrivacyStatus()
  const updateConfigured = updateService.getStatus().state !== "unconfigured"
  const configurationRequired = app.isPackaged
  const releaseConfigurationMissing =
    configurationRequired &&
    (!telemetryStatus.telemetryConfigured || !updateConfigured)
  return {
    ...telemetryStatus,
    acknowledged: telemetryStatus.acknowledged && !releaseConfigurationMissing,
    updateConfigured,
    configurationRequired,
  }
}

async function checkWorkbenchEnvironment(): Promise<DiagnosticEnvironmentInput> {
  const environment = await requestSidecar<DiagnosticEnvironmentInput>("environment.check", {})
  environment.checks.push(await checkThesisTemplateResource(path.join(app.getAppPath(), "resources", "thesis-template")))
  return environment
}

function registerIpc(): void {
  ipcMain.handle("sztu:close-complete", (event, input: unknown) => {
    assertTrustedSender(event)
    return runBridge(() => {
      if (!isRecord(input)) throw new IpcValidationError("关闭确认必须是对象。")
      assertExactKeys(input, ["requestId", "outcome"], ["reason"])
      assertRequestId(input.requestId)
      if (input.outcome !== "saved" && input.outcome !== "failed") {
        throw new IpcValidationError("保存状态无效，无法关闭窗口。")
      }
      if (input.reason !== undefined && input.reason !== "conflict" && input.reason !== "save_failed") {
        throw new IpcValidationError("关闭失败原因无效。")
      }
      if (input.outcome === "saved" && input.reason !== undefined) {
        throw new IpcValidationError("保存状态无效，无法关闭窗口。")
      }
      const window = BrowserWindow.fromWebContents(event.sender)
      const matched = window && closeCoordinator.complete(window.id, {
        requestId: input.requestId,
        outcome: input.outcome,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
      })
      return { accepted: Boolean(matched && input.outcome === "saved") }
    })
  })
  ipcMain.handle("sztu:app-info", (event) => {
    assertTrustedSender(event)
    return runBridge(() => ({
        appVersion: app.getVersion(),
        electronVersion: process.versions.electron,
        platform: process.platform,
      }))
  })

  ipcMain.handle("sztu:environment-check", async (event) => {
    assertTrustedSender(event)
    return runBridge(checkWorkbenchEnvironment)
  })

  ipcMain.handle("sztu:diagnostic-prepare", (event, reportId: unknown) => {
    assertTrustedSender(event)
    return runBridge(async () => {
      if (!fullDiagnostics) throw new IpcValidationError("诊断服务尚未初始化。")
      if (reportId !== undefined) {
        assertRequestId(reportId, "诊断包编号")
        const existing = await fullDiagnostics.get(reportId)
        if (!existing) throw new FullDiagnosticError("本次故障的诊断材料已失效，请重现问题后再创建诊断包。")
        return existing
      }
      const recent = await fullDiagnostics.latest()
      if (recent) return recent
      const result = await requestSidecar<{ diagnostic_case_id?: string }>("diagnostic.prepare", {}, 90_000)
      const prepared = result.diagnostic_case_id && await fullDiagnostics.get(result.diagnostic_case_id)
      if (!prepared) throw new FullDiagnosticError("诊断包创建失败，请重试。")
      return prepared
    })
  })

  ipcMain.handle("sztu:diagnostic-save", async (event, reportId: unknown) => {
    assertTrustedSender(event)
    return runBridge(async () => {
      assertRequestId(reportId, "故障包编号")
      if (!fullDiagnostics) throw new IpcValidationError("故障包服务尚未初始化。")
      const options: SaveDialogOptions = {
        title: "保存诊断包",
        defaultPath: path.join(app.getPath("documents"), `SZTU-诊断包-${reportId}.zip`),
        filters: [{ name: "ZIP 诊断包", extensions: ["zip"] }],
        properties: ["createDirectory", "showOverwriteConfirmation"],
      }
      const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { saved: false }
      await fullDiagnostics.save(reportId, result.filePath)
      return { saved: true }
    })
  })

  ipcMain.handle("sztu:diagnostic-send", (event, reportId: unknown) => {
    assertTrustedSender(event)
    return runBridge(() => {
      assertRequestId(reportId, "故障包编号")
      if (!fullDiagnostics) throw new IpcValidationError("故障包服务尚未初始化。")
      return fullDiagnostics.send(reportId)
    })
  })

  ipcMain.handle("sztu:thesis-template-download", async (event) => {
    assertTrustedSender(event)
    return runBridge(() => downloadThesisTemplate(
      path.join(app.getAppPath(), "resources", "thesis-template"),
      async (fileName) => {
        const options: SaveDialogOptions = {
          title: "下载毕业论文 LaTeX 模板",
          defaultPath: path.join(app.getPath("downloads"), fileName),
          filters: [{ name: "LaTeX 源码工程", extensions: ["zip"] }],
          properties: ["createDirectory", "showOverwriteConfirmation"],
        }
        const result = mainWindow
          ? await dialog.showSaveDialog(mainWindow, options)
          : await dialog.showSaveDialog(options)
        return result.canceled || !result.filePath ? null : result.filePath
      },
    ))
  })

  ipcMain.handle("sztu:privacy-status", (event) => {
    assertTrustedSender(event)
    return runBridge(() => privacyNoticeStatus())
  })

  ipcMain.handle("sztu:privacy-accept", (event) => {
    assertTrustedSender(event)
    return runBridge(async () => {
      if (!telemetry) throw new Error("Telemetry service is not initialized.")
      const current = privacyNoticeStatus()
      if (
        current.configurationRequired &&
        (!current.telemetryConfigured || !current.updateConfigured)
      ) {
        throw new IpcValidationError(
          "应用配置不完整，请重新安装或联系开发者。",
        )
      }
      await telemetry.acceptNotice()
      await startRemoteServices()
      return privacyNoticeStatus()
    })
  })

  ipcMain.handle("sztu:app-quit", (event) => {
    assertTrustedSender(event)
    return runBridge(() => {
      setImmediate(() => app.quit())
      return null
    })
  })

  ipcMain.handle("sztu:telemetry-record", (event, input: unknown) => {
    assertTrustedSender(event)
    return runBridge(async () => {
      if (!telemetry) throw new Error("Telemetry service is not initialized.")
      let parsed
      try {
        parsed = parseTelemetryUsageEvent(input)
      } catch {
        throw new IpcValidationError("不支持当前使用统计事件。")
      }
      await telemetry.recordUsage(parsed)
      return null
    })
  })

  ipcMain.handle("sztu:telemetry-completion-count", (event) => {
    assertTrustedSender(event)
    return runBridge(async () => {
      if (!telemetry) throw new Error("Telemetry service is not initialized.")
      return telemetry.getCompletionCount()
    })
  })

  ipcMain.handle("sztu:telemetry-complete-document", (event, input: unknown) => {
    assertTrustedSender(event)
    return runBridge(async () => {
      if (!telemetry) throw new Error("Telemetry service is not initialized.")
      if (!isRecord(input)) throw new IpcValidationError("文档完成状态参数无效。")
      assertExactKeys(input, ["documentId", "documentType"])
      assertResourceId(input.documentId)
      if (!["proposal", "task_book", "midterm", "advisor_review", "reviewer_review", "defense_record", "grade_assessment"].includes(String(input.documentType))) {
        throw new IpcValidationError("不支持当前文档类型。")
      }
      return telemetry.recordDocumentCompletion(
        input.documentId,
        input.documentType as "proposal" | "task_book" | "midterm" | "advisor_review" | "reviewer_review" | "defense_record" | "grade_assessment",
      )
    })
  })

  ipcMain.handle("sztu:update-status", (event) => {
    assertTrustedSender(event)
    return runBridge<UpdateStatus>(() =>
      updateService?.getStatus() ?? { state: "unconfigured" },
    )
  })

  ipcMain.handle("sztu:midterm-date-policy-status", (event) => {
    assertTrustedSender(event)
    return runBridge<MidtermDatePolicyStatus>(() =>
      midtermDatePolicyService?.getStatus() ?? { state: "unconfigured", rules: [] },
    )
  })

  ipcMain.handle("sztu:update-download", (event) => {
    assertTrustedSender(event)
    return runBridge<UpdateStatus>(() => updateService?.downloadNow() ?? { state: "unconfigured" })
  })

  ipcMain.handle("sztu:update-reveal", (event) => {
    assertTrustedSender(event)
    return runBridge(() => {
      const downloadedPath = updateService?.revealDownloadedPath()
      if (!downloadedPath) throw new IpcValidationError("未找到可用的更新安装包，请重新下载。")
      shell.showItemInFolder(downloadedPath)
      return null
    })
  })

  ipcMain.handle("sztu:update-open-help", (event) => {
    assertTrustedSender(event)
    return runBridge(async () => {
      const helpUrl = updateService?.getHelpUrl()
      if (!helpUrl) throw new IpcValidationError("当前没有可用的使用说明链接。")
      await shell.openExternal(helpUrl)
      return null
    })
  })

  ipcMain.handle("sztu:tool-open", (event, toolId: unknown) => {
    assertTrustedSender(event)
    return runBridge(async () => {
      if (
        typeof toolId !== "string" ||
        !Object.prototype.hasOwnProperty.call(TOOL_LINKS, toolId)
      ) {
        throw new IpcValidationError("未识别的外部指引链接。")
      }
      await shell.openExternal(TOOL_LINKS[toolId as ToolLinkId])
      return null
    })
  })

  ipcMain.handle("sztu:clipboard-write-text", (event, text: unknown) => {
    assertTrustedSender(event)
    return runBridge(async () => {
      if (typeof text !== "string" || text.length > MAX_CLIPBOARD_TEXT_LENGTH) {
        throw new IpcValidationError("剪贴板文本无效或过长。")
      }
      await clipboard.writeText(text)
      return null
    })
  })

  ipcMain.handle("sztu:clipboard-write-png", (event, dataUrl: unknown) => {
    assertTrustedSender(event)
    return runBridge(async () => {
      const bytes = decodeClipboardPng(dataUrl)
      await clipboard.write([new ClipboardItem({
        "image/png": new Blob([Uint8Array.from(bytes)], { type: "image/png" }),
      })])
      return null
    })
  })

  const importManagedImage = async (sourcePath: string) => {
    const fileStat = await lstat(sourcePath)
    if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size > MAX_IMAGE_ASSET_BYTES) {
      throw new IpcValidationError("请选择小于 20 MiB 的图片文件。")
    }
    const bytes = await readFile(sourcePath)
    const mimeType = detectImageMime(bytes)
    if (!mimeType) throw new IpcValidationError("请选择 PNG 或 JPEG 图片。")
    const sha256 = createHash("sha256").update(bytes).digest("hex")
    const suffix = mimeType === "image/png" ? "png" : "jpg"
    const fileName = `${sha256}.${suffix}`
    const directory = imageAssetDirectory()
    const target = path.resolve(directory, fileName)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    try {
      await writeFile(target, bytes, { flag: "wx", mode: 0o600 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    }
    return {
      path: target,
      previewUrl: `sztu-asset://asset/${fileName}`,
      originalName: path.basename(sourcePath),
      mimeType,
      sizeBytes: bytes.length,
      sha256,
    }
  }

  ipcMain.handle("sztu:asset-preview-data", async (event, fileName: unknown) => {
    assertTrustedSender(event)
    return runBridge(async () => {
      if (typeof fileName !== "string" || !MANAGED_IMAGE_NAME_PATTERN.test(fileName)) {
        throw new IpcValidationError("图片资源名称无效。")
      }
      const asset = await readManagedImageAsset(fileName)
      if (asset.status !== 200) throw new IpcValidationError("图片资源不存在或已损坏，请重新导入。")
      return `data:${asset.mimeType};base64,${asset.bytes.toString("base64")}`
    })
  })

  ipcMain.handle("sztu:asset-import-image", async (event) => {
    assertTrustedSender(event)
    return runBridge(async () => {
      const options: OpenDialogOptions = {
        title: "选择论文图片",
        filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg"] }],
        properties: ["openFile", "dontAddToRecent"],
      }
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options)
      const sourcePath = result.filePaths[0]
      if (result.canceled || !sourcePath) return null
      return importManagedImage(sourcePath)
    })
  })

  ipcMain.handle("sztu:asset-import-images", async (event) => {
    assertTrustedSender(event)
    return runBridge(async () => {
      const options: OpenDialogOptions = {
        title: "选择组合图图片（最多 4 张）", filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg"] }],
        properties: ["openFile", "multiSelections", "dontAddToRecent"],
      }
      const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
      if (result.canceled) return []
      if (result.filePaths.length > 4) throw new IpcValidationError("一次最多选择 4 张图片。")
      return Promise.all(result.filePaths.map(importManagedImage))
    })
  })

  ipcMain.handle("sztu:workspace-open", async (event, mode: unknown) => {
    assertTrustedSender(event)
    return runBridge(() => {
      if (mode !== "persistent" && mode !== "temporary") {
        throw new IpcValidationError("工作区模式无效。")
      }
      return requestSidecar("workspace.open", { mode, initialize_reference: mode === "persistent", all_documents: true })
    })
  })

  ipcMain.handle("sztu:workspace-list-documents", async (event, input: unknown) => {
    assertTrustedSender(event)
    return runBridge(async () => {
      if (!isRecord(input)) throw new IpcValidationError("文档列表请求参数无效。")
      assertExactKeys(input, ["profileId", "deleted"], ["cursor", "limit"])
      if (input.profileId !== null) assertResourceId(input.profileId, "学生档案编号")
      if (typeof input.deleted !== "boolean") throw new IpcValidationError("文档列表筛选条件无效。")
      if (input.cursor !== undefined) assertDocumentListCursor(input.cursor)
      const limit = input.limit ?? 100
      if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100) {
        throw new IpcValidationError("每次可读取 1 至 100 份文档。")
      }
      const result = await requestSidecar<unknown>("workspace.listDocuments", {
        profile_id: input.profileId,
        deleted: input.deleted,
        limit,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      })
      if (!isRecord(result) || !Array.isArray(result.documents) || result.documents.length > Number(limit) ||
        result.profile_id !== input.profileId || result.deleted !== input.deleted || typeof result.has_more !== "boolean") {
        throw new SidecarError("INVALID_SIDECAR_RESULT", "文档列表返回无效，请重新载入工作区。")
      }
      assertExactKeys(result, ["documents", "profile_id", "deleted", "next_cursor", "has_more"])
      if (result.has_more) assertDocumentListCursor(result.next_cursor)
      else if (result.next_cursor !== null) throw new SidecarError("INVALID_SIDECAR_RESULT", "文档列表游标无效。")
      for (const document of result.documents) {
        if (!isRecord(document)) throw new SidecarError("INVALID_SIDECAR_RESULT", "文档列表项无效。")
        assertResourceId(document.id, "文档编号")
        assertText(document.title, "文档名称", 240)
        assertText(document.document_type, "文档类型", 64)
      }
      return result
    })
  })

  ipcMain.handle("sztu:workspace-save-profile", async (event, profile: unknown) => {
    assertTrustedSender(event)
    return runBridge(() => {
      assertProfile(profile)
      return requestSidecar("workspace.saveProfile", { profile })
    })
  })

  ipcMain.handle("sztu:workspace-save-profile-draft", async (event, profile: unknown, profileId: unknown) => {
    assertTrustedSender(event)
    return runBridge(() => {
      assertProfileDraft(profile)
      if (profileId !== undefined && profileId !== null) assertResourceId(profileId, "学生档案编号")
      return requestSidecar("workspace.saveProfileDraft", { profile, ...(profileId !== undefined ? { profile_id: profileId } : {}) })
    })
  })

  ipcMain.handle("sztu:workspace-create-profile", async (event, profile: unknown) => {
    assertTrustedSender(event)
    return runBridge(() => {
      assertProfile(profile)
      if (profile.id !== undefined) throw new IpcValidationError("新增档案不能指定已有档案编号。")
      return requestSidecar("workspace.createProfile", { profile })
    })
  })

  ipcMain.handle("sztu:workspace-select-profile", async (event, profileId: unknown) => {
    assertTrustedSender(event)
    return runBridge(() => {
      if (profileId !== null) assertResourceId(profileId, "学生档案编号")
      return requestSidecar("workspace.selectProfile", { profile_id: profileId })
    })
  })

  ipcMain.handle("sztu:workspace-delete-profile", async (event, profileId: unknown) => {
    assertTrustedSender(event)
    return runBridge(() => {
      assertResourceId(profileId, "学生档案编号")
      return requestSidecar("workspace.deleteProfile", { profile_id: profileId })
    })
  })

  ipcMain.handle("sztu:workspace-restore-profile", async (event, profileId: unknown) => {
    assertTrustedSender(event)
    return runBridge(() => {
      assertResourceId(profileId, "学生档案编号")
      return requestSidecar("workspace.restoreProfile", { profile_id: profileId })
    })
  })

  ipcMain.handle("sztu:workspace-create-document", async (event, document: unknown) => {
    assertTrustedSender(event)
    return runBridge(() => {
      assertDocument(document)
      return requestSidecar("workspace.createDocument", { document })
    })
  })

  ipcMain.handle("sztu:workspace-select-document", async (event, documentId: unknown) => {
    assertTrustedSender(event)
    return runBridge(() => {
      assertResourceId(documentId)
      return requestSidecar("workspace.selectDocument", { document_id: documentId })
    })
  })

  ipcMain.handle("sztu:workspace-rename-document", async (event, input: unknown) => {
    assertTrustedSender(event)
    return runBridge(() => {
      if (!isRecord(input)) throw new IpcValidationError("重命名参数无效。")
      assertExactKeys(input, ["documentId", "title"])
      assertResourceId(input.documentId)
      assertText(input.title, "文档名称", 240)
      return requestSidecar("workspace.renameDocument", {
        document_id: input.documentId,
        title: input.title,
      })
    })
  })

  for (const [channel, method] of [
    ["sztu:workspace-delete-document", "workspace.deleteDocument"],
    ["sztu:workspace-restore-document", "workspace.restoreDocument"],
    ["sztu:workspace-purge-document", "workspace.purgeDocument"],
  ] as const) {
    ipcMain.handle(channel, async (event, documentId: unknown) => {
      assertTrustedSender(event)
      return runBridge(() => {
        assertResourceId(documentId)
        return requestSidecar(method, { document_id: documentId })
      })
    })
  }

  ipcMain.handle("sztu:workspace-save-draft", async (event, input: unknown) => {
    assertTrustedSender(event)
    return runBridge(() => {
      if (!isRecord(input)) throw new IpcValidationError("草稿保存参数无效。")
      assertExactKeys(input, ["documentId", "content", "expectedRevision"], ["reason"])
      assertResourceId(input.documentId)
      if (!isRecord(input.content)) throw new IpcValidationError("文档内容格式无效。")
      assertJsonValue(input.content)
      if (!Number.isInteger(input.expectedRevision) || (input.expectedRevision as number) < 0) {
        throw new IpcValidationError("草稿版本号无效。")
      }
      if (input.reason !== undefined && input.reason !== "auto" && input.reason !== "manual") {
        throw new IpcValidationError("草稿保存参数无效。")
      }
      return requestSidecar<Record<string, unknown>>("workspace.saveDraft", {
        document_id: input.documentId,
        content: input.content,
        expected_revision: input.expectedRevision,
        reason: input.reason ?? "auto",
      }).then((document) => {
        assertResourceId(document.id, "文档编号")
        if (!Number.isInteger(document.current_revision) || (document.current_revision as number) < 0) {
          throw new SidecarError("INVALID_SIDECAR_RESULT", "Sidecar returned an invalid revision.")
        }
        if (document.save_reason !== "auto" && document.save_reason !== "manual") {
          throw new SidecarError("INVALID_SIDECAR_RESULT", "Sidecar returned an invalid save reason.")
        }
        if (typeof document.saved_at !== "string" || document.saved_at.length < 1 || document.saved_at.length > 100) {
          throw new SidecarError("INVALID_SIDECAR_RESULT", "Sidecar returned an invalid save time.")
        }
        return {
          document_id: document.id,
          revision: document.current_revision,
          save_reason: document.save_reason,
          saved_at: document.saved_at,
        }
      })
    })
  })

  ipcMain.handle("sztu:workspace-close-temporary", async (event, documentId: unknown) => {
    assertTrustedSender(event)
    return runBridge(() => {
      assertResourceId(documentId)
      return requestSidecar("workspace.closeTemporary", { document_id: documentId })
    })
  })

  ipcMain.handle("sztu:document-check", async (event, documentId: unknown) => {
    assertTrustedSender(event)
    return runBridge(() => {
      assertResourceId(documentId)
      return requestSidecar("document.check", { document_id: documentId })
    })
  })

  ipcMain.handle("sztu:preview-generate", async (event, input: unknown) => {
    assertTrustedSender(event)
    return runBridge(async () => {
      if (!isRecord(input)) throw new IpcValidationError("预览参数必须是对象。")
      assertExactKeys(input, ["requestId", "documentId"])
      assertRequestId(input.requestId)
      assertResourceId(input.documentId)
      if (activePreviewCancellationFiles.has(input.requestId)) {
        throw new IpcValidationError("预览任务正在运行。")
      }
      const marker = cancellationPath(input.requestId)
      await mkdir(path.dirname(marker), { recursive: true, mode: 0o700 })
      await removeCancellationMarker(marker)
      activePreviewCancellationFiles.set(input.requestId, marker)
      let verificationStarted: number | undefined
      const verificationContext = { ...activeDiagnosticContext, stage: "preview_verify", request_id: input.requestId }
      try {
        const result = await requestSidecar<unknown>(
          "preview.generate",
          {
            request_id: input.requestId,
            document_id: input.documentId,
            cancellation_file: marker,
            app_version: app.getVersion(),
          },
          120_000,
        )
        verificationStarted = Date.now()
        if (!isRecord(result)) {
          throw new SidecarError("INVALID_SIDECAR_RESULT", "Sidecar returned an invalid preview.")
        }
        assertExactKeys(result, [
          "schema_version",
          "preview_id",
          "document_id",
          "document_revision",
          "input_sha256",
          "template",
          "pdf",
          "pages",
          "checks",
          "generated_at",
        ])
        if (result.schema_version !== "1.0" || result.document_id !== input.documentId) {
          throw new SidecarError("INVALID_SIDECAR_RESULT", "Sidecar preview identity is invalid.")
        }
        assertResourceId(result.preview_id, "预览编号")
        if (!Number.isInteger(result.document_revision) || (result.document_revision as number) < 1) {
          throw new SidecarError("INVALID_SIDECAR_RESULT", "Sidecar preview revision is invalid.")
        }
        if (typeof result.input_sha256 !== "string" || !SHA256_PATTERN.test(result.input_sha256)) {
          throw new SidecarError("INVALID_SIDECAR_RESULT", "Sidecar preview input hash is invalid.")
        }
        if (!isRecord(result.template)) {
          throw new SidecarError("INVALID_SIDECAR_RESULT", "Sidecar preview template is invalid.")
        }
        assertExactKeys(result.template, ["template_id", "version", "pack_sha256"])
        assertText(result.template.template_id, "模板编号", 128)
        assertText(result.template.version, "模板版本", 128)
        if (typeof result.template.pack_sha256 !== "string" || !SHA256_PATTERN.test(result.template.pack_sha256)) {
          throw new SidecarError("INVALID_SIDECAR_RESULT", "Sidecar preview template hash is invalid.")
        }
        assertText(result.generated_at, "预览生成时间", 100)
        assertJsonValue(result.checks)
        if (!Array.isArray(result.checks) || !isRecord(result.pdf) || !Array.isArray(result.pages)) {
          throw new SidecarError("INVALID_SIDECAR_RESULT", "Sidecar preview artifacts are invalid.")
        }
        if (result.pages.length < 1 || result.pages.length > 80) {
          throw new SidecarError("INVALID_SIDECAR_RESULT", "Sidecar preview page count is invalid.")
        }
        const previewRoot = await privatePreviewRoot(
          app.getPath("userData"),
          input.documentId,
          result.preview_id,
        )
        assertExactKeys(result.pdf, ["absolute_path", "sha256", "size_bytes"])
        assertText(result.pdf.absolute_path, "预览文件路径", 4096)
        if (
          typeof result.pdf.sha256 !== "string" ||
          !SHA256_PATTERN.test(result.pdf.sha256) ||
          !Number.isInteger(result.pdf.size_bytes) ||
          (result.pdf.size_bytes as number) < 1
        ) {
          throw new SidecarError("INVALID_SIDECAR_RESULT", "Sidecar preview PDF descriptor is invalid.")
        }
        await verifyPreviewPdf(
          result.pdf.absolute_path as string,
          previewRoot,
          result.pdf.sha256,
          result.pdf.size_bytes as number,
        )
        const pages: Array<{
          page_number: number
          sha256: string
          size_bytes: number
          data_url: string
        }> = []
        let totalSize = 0
        for (const [index, rawPage] of result.pages.entries()) {
          if (!isRecord(rawPage)) {
            throw new SidecarError("INVALID_SIDECAR_RESULT", "Sidecar preview page is invalid.")
          }
          assertExactKeys(rawPage, ["page_number", "absolute_path", "sha256", "size_bytes"])
          assertText(rawPage.absolute_path, "预览页面路径", 4096)
          if (
            rawPage.page_number !== index + 1 ||
            typeof rawPage.sha256 !== "string" ||
            !SHA256_PATTERN.test(rawPage.sha256) ||
            !Number.isInteger(rawPage.size_bytes) ||
            (rawPage.size_bytes as number) < 1
          ) {
            throw new SidecarError("INVALID_SIDECAR_RESULT", "Sidecar preview page descriptor is invalid.")
          }
          totalSize += rawPage.size_bytes as number
          if (totalSize > 80_000_000) {
            throw new SidecarError("INVALID_SIDECAR_RESULT", "Sidecar preview pages exceed the size limit.")
          }
          pages.push({
            page_number: rawPage.page_number as number,
            sha256: rawPage.sha256,
            size_bytes: rawPage.size_bytes as number,
            data_url: await readVerifiedPreviewPage(
              rawPage.absolute_path as string,
              previewRoot,
              rawPage.sha256,
              rawPage.size_bytes as number,
            ),
          })
        }
        void sidecar?.request("diagnostic.finishPreview", { case_id: input.requestId }, 30_000).catch(() => undefined)
        diagnostics?.record("diagnostic.step", "success", Date.now() - verificationStarted, undefined, verificationContext)
        return {
          schema_version: "1.0" as const,
          preview_id: result.preview_id,
          document_id: result.document_id,
          document_revision: result.document_revision,
          input_sha256: result.input_sha256,
          template: result.template,
          pages,
          checks: result.checks,
          generated_at: result.generated_at,
        }
      } catch (error) {
        if (verificationStarted !== undefined) {
          await sidecar?.request("diagnostic.finishPreview", {
            case_id: input.requestId,
            error: { stack: error instanceof Error ? error.stack : String(error), code: stableDiagnosticErrorCode(error) },
          }, 30_000).catch(() => undefined)
          const failure = error instanceof SidecarError ? error : new SidecarError("PREVIEW_VERIFY_FAILED", "预览文件验证失败。")
          failure.diagnosticCaseId = input.requestId
          diagnostics?.record("diagnostic.step", "failure", Date.now() - verificationStarted,
            stableDiagnosticErrorCode(error), verificationContext)
          throw failure
        }
        throw error
      } finally {
        activePreviewCancellationFiles.delete(input.requestId)
        await removeCancellationMarker(marker)
      }
    })
  })

  ipcMain.handle("sztu:choose-export-directory", async (event) => {
    assertTrustedSender(event)
    return runBridge(async () => {
      const options: OpenDialogOptions = {
        title: "选择文档输出文件夹",
        buttonLabel: "选择此文件夹",
        properties: ["openDirectory", "createDirectory"],
      }
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options)
      const [selectedDirectory] = result.filePaths
      if (result.canceled || result.filePaths.length !== 1 || !selectedDirectory) return null
      const directory = path.resolve(selectedDirectory)
      approvedExportDirectories.add(directory)
      return directory
    })
  })

  ipcMain.handle("sztu:export-preflight", async (event, input: unknown) => {
    assertTrustedSender(event)
    return runBridge(() => {
      if (!isRecord(input)) throw new IpcValidationError("导出预检参数无效。")
      assertExactKeys(input, ["documentId", "previewId", "outputDirectory", "formats"])
      assertResourceId(input.documentId)
      assertResourceId(input.previewId, "预览编号")
      assertExportFormats(input.formats)
      assertText(input.outputDirectory, "导出目录", 4096)
      if (!path.isAbsolute(input.outputDirectory as string)) {
        throw new IpcValidationError("保存位置无效，请重新选择文件夹。")
      }
      const outputDirectory = path.resolve(input.outputDirectory as string)
      if (!approvedExportDirectories.has(outputDirectory)) {
        throw new IpcValidationError("请点击“选择文件夹”确认保存位置。")
      }
      const params: Record<string, unknown> = {
        document_id: input.documentId,
        preview_id: input.previewId,
        output_directory: outputDirectory,
        formats: input.formats,
      }
      return requestSidecar("export.preflight", params, 30_000)
    })
  })

  ipcMain.handle("sztu:export-document", async (event, input: unknown) => {
    assertTrustedSender(event)
    return runBridge(() => {
      if (!isRecord(input)) throw new IpcValidationError("导出参数必须是对象。")
      assertExactKeys(
        input,
        ["requestId", "documentId", "previewId", "outputDirectory", "formats", "preflightToken", "overwriteConfirmed"],
      )
      assertRequestId(input.requestId)
      assertResourceId(input.documentId)
      assertResourceId(input.previewId, "预览编号")
      assertText(input.outputDirectory, "导出目录", 4096)
      if (!path.isAbsolute(input.outputDirectory as string)) {
        throw new IpcValidationError("保存位置无效，请重新选择文件夹。")
      }
      const outputDirectory = path.resolve(input.outputDirectory as string)
      if (!approvedExportDirectories.delete(outputDirectory)) {
        throw new IpcValidationError("请点击“选择文件夹”确认保存位置。")
      }
      assertExportFormats(input.formats)
      if (typeof input.overwriteConfirmed !== "boolean") {
        throw new IpcValidationError("请重新确认是否替换已有文件。")
      }
      if (typeof input.preflightToken !== "string" || !SHA256_PATTERN.test(input.preflightToken)) {
        throw new IpcValidationError("导出校验信息无效，请重新导出。")
      }
      const params: Record<string, unknown> = {
        request_id: input.requestId,
        document_id: input.documentId,
        preview_id: input.previewId,
        output_directory: outputDirectory,
        formats: input.formats,
        preflight_token: input.preflightToken,
        overwrite_confirmed: input.overwriteConfirmed,
        app_version: app.getVersion(),
      }
      if (activeCancellationFiles.has(input.requestId)) {
        throw new IpcValidationError("导出任务正在运行。")
      }
      const marker = cancellationPath(input.requestId)
      return mkdir(path.dirname(marker), { recursive: true, mode: 0o700 })
        .then(() => removeCancellationMarker(marker))
        .then(() => {
          activeCancellationFiles.set(input.requestId as string, marker)
          params.cancellation_file = marker
          return requestSidecar("export.run", params, EXPORT_RUN_TIMEOUT_MS).catch((error: unknown) => {
            throw normalizeExportRunError(error)
          })
        })
        .finally(async () => {
          activeCancellationFiles.delete(input.requestId as string)
          try {
            await removeCancellationMarker(marker)
          } catch (error) {
            // Cleanup must not replace the real export result (for example, EXPORT_TIMEOUT).
            console.error("Failed to remove the export cancellation marker.", error)
          }
        })
    })
  })

  ipcMain.handle("sztu:export-cancel", async (event, requestId: unknown) => {
    assertTrustedSender(event)
    return runBridge(async () => {
      assertRequestId(requestId)
      const marker = activeCancellationFiles.get(requestId)
      if (!marker) {
        return {
          request_id: requestId,
          accepted: false,
          status: "not_running" as const,
          cancel_requested_at: null,
        }
      }
      await mkdir(path.dirname(marker), { recursive: true, mode: 0o700 })
      try {
        await writeFile(marker, "cancel\n", { encoding: "utf8", flag: "wx", mode: 0o600 })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      }
      return {
        request_id: requestId,
        accepted: true,
        status: "cancel_requested" as const,
        cancel_requested_at: new Date().toISOString(),
      }
    })
  })

  ipcMain.handle("sztu:export-history", async (event, input: unknown) => {
    assertTrustedSender(event)
    return runBridge(() => {
      if (!isRecord(input)) throw new IpcValidationError("导出记录查询参数无效。")
      assertExactKeys(input, ["documentId"], ["limit"])
      assertResourceId(input.documentId)
      const params: Record<string, unknown> = { document_id: input.documentId }
      if (input.limit !== undefined) {
        if (!Number.isInteger(input.limit) || (input.limit as number) < 1 || (input.limit as number) > 100) {
          throw new IpcValidationError("导出记录分页信息无效。")
        }
        params.limit = input.limit
      }
      return requestSidecar("export.history", params, 15_000)
    })
  })

  ipcMain.handle("sztu:export-reveal-artifact", async (event, artifactId: unknown) => {
    assertTrustedSender(event)
    return runBridge(async () => {
      assertResourceId(artifactId, "导出文件编号")
      const resolved = await requestSidecar<unknown>(
        "export.resolveArtifact",
        { artifact_id: artifactId },
        15_000,
      )
      if (!isRecord(resolved)) {
        throw new SidecarError("INVALID_SIDECAR_RESULT", "Sidecar returned an invalid artifact.")
      }
      const keys = Object.keys(resolved)
      if (
        keys.length !== 5 ||
        !["artifact_id", "format", "absolute_path", "sha256", "verified"].every((key) => key in resolved)
      ) {
        throw new SidecarError("INVALID_SIDECAR_RESULT", "Sidecar returned unexpected artifact fields.")
      }
      assertResourceId(resolved.artifact_id, "导出文件编号")
      assertText(resolved.absolute_path, "导出文件路径", 4096)
      if (
        resolved.artifact_id !== artifactId ||
        (resolved.format !== "docx" && resolved.format !== "pdf" && resolved.format !== "tex") ||
        resolved.verified !== true ||
        typeof resolved.sha256 !== "string" ||
        !SHA256_PATTERN.test(resolved.sha256) ||
        !path.isAbsolute(resolved.absolute_path as string) ||
        path.resolve(resolved.absolute_path as string) !== resolved.absolute_path
      ) {
        throw new SidecarError("INVALID_SIDECAR_RESULT", "Sidecar artifact verification failed.")
      }
      shell.showItemInFolder(resolved.absolute_path as string)
      return { artifact_id: artifactId, revealed: true as const }
    })
  })

  ipcMain.handle("sztu:export-delete-history", async (event, input: unknown) => {
    assertTrustedSender(event)
    return runBridge(() => {
      if (!isRecord(input)) throw new IpcValidationError("导出记录删除参数无效。")
      assertExactKeys(input, ["documentId", "exportId"])
      assertResourceId(input.documentId, "文档编号")
      assertResourceId(input.exportId, "导出记录编号")
      return requestSidecar(
        "export.deleteHistory",
        { document_id: input.documentId, export_id: input.exportId },
        15_000,
      )
    })
  })

  ipcMain.handle("sztu:template-install", async (event, documentType: unknown) => {
    assertTrustedSender(event)
    return runBridge(async () => {
      if (
        documentType !== "proposal" &&
        documentType !== "task_book" &&
        documentType !== "midterm" &&
        documentType !== "thesis" &&
        documentType !== "advisor_review" &&
        documentType !== "reviewer_review" &&
        documentType !== "defense_record" &&
        documentType !== "grade_assessment"
      ) {
        throw new IpcValidationError(
          "不支持当前文档类型。",
        )
      }
      const options: OpenDialogOptions = {
        title:
          documentType === "task_book"
            ? "关联包含任务书模板的本地工程"
            : documentType === "thesis"
              ? "关联包含毕业论文模板的本地工程"
            : documentType === "midterm"
              ? "关联包含中期检查模板的本地工程"
              : documentType === "proposal" ? "关联包含开题报告模板的本地工程"
              : "关联包含评审表模板的本地工程",
        buttonLabel: "关联并同步",
        properties: ["openDirectory"],
      }
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options)
      const [selectedDirectory] = result.filePaths
      if (result.canceled || result.filePaths.length !== 1 || !selectedDirectory) return null
      const sourceDirectory = path.resolve(selectedDirectory)
      return requestSidecar(
        "template.install",
        { source_directory: sourceDirectory, document_type: documentType },
        60_000,
      )
    })
  })

  ipcMain.handle("sztu:qa-record", async (event, input: unknown) => {
    assertTrustedSender(event)
    return runBridge(() => {
      if (!isRecord(input)) throw new IpcValidationError("检查结果格式无效。")
      assertExactKeys(input, ["gate", "status", "message"], ["exportId", "artifactId", "editor"])
      if (input.exportId !== undefined) assertResourceId(input.exportId, "导出记录编号")
      if (input.artifactId !== undefined) assertResourceId(input.artifactId, "导出文件编号")
      if (input.gate !== "full_page_layout" && input.gate !== "target_editor") {
        throw new IpcValidationError("请选择逐页版式检查或 Word/WPS 检查。")
      }
      if (input.status !== "pass" && input.status !== "fail") {
        throw new IpcValidationError("请选择检查通过或未通过。")
      }
      if (input.gate === "target_editor") {
        if (
          input.artifactId === undefined ||
          (input.editor !== "word" && input.editor !== "wps")
        ) {
          throw new IpcValidationError("请先选择要检查的 Word 文件和使用的 Word/WPS。")
        }
      } else if (input.editor !== undefined) {
        throw new IpcValidationError("逐页版式检查无需选择 Word/WPS，请重新填写。")
      } else if (input.exportId === undefined) {
        throw new IpcValidationError("请先选择要检查的导出记录。")
      }
      assertText(input.message, "检查备注", 1000)
      const params: Record<string, unknown> = {
        gate: input.gate,
        status: input.status,
        message: input.message,
      }
      if (input.artifactId !== undefined) params.artifact_id = input.artifactId
      if (input.exportId !== undefined) params.export_id = input.exportId
      if (input.editor !== undefined) params.editor = input.editor
      return requestSidecar("qa.record", params, 15_000)
    })
  })
}

let activeDiagnosticContext: DiagnosticContext = {}

async function requestSidecar<T>(
  method: SidecarMethod,
  params: Record<string, unknown>,
  timeoutMs?: number,
): Promise<T> {
  const startedAt = Date.now()
  const requestId = diagnosticContext({ request_id: params.request_id }).request_id ?? randomUUID()
  const operationContext = { ...activeDiagnosticContext, request_id: requestId }
  sidecar ??= new SidecarChannels(
    new SidecarClient(backendRoot(), app.getPath("userData"), undefined, { role: "control", retryRequests: false, appVersion: app.getVersion() }),
    new SidecarClient(backendRoot(), app.getPath("userData"), undefined, { role: "render", retryRequests: false, appVersion: app.getVersion() }),
    app.getPath("userData"),
  )
  try {
    const result = await sidecar.request<T>(method, params, timeoutMs, ({ outcome, duration_ms, error_code, ...context }) => {
      if (outcome === "started") return
      diagnostics?.record("diagnostic.step", outcome, duration_ms, error_code, { ...operationContext, ...context })
    })
    if (method === "workspace.saveProfile" || method === "workspace.saveProfileDraft") {
      telemetry?.setAcademicProfile(params.profile)
    } else if (["workspace.open", "workspace.createProfile", "workspace.selectProfile", "workspace.deleteProfile", "workspace.restoreProfile", "workspace.selectDocument", "workspace.deleteDocument", "workspace.restoreDocument", "workspace.purgeDocument"].includes(method)) {
      const snapshot = result as Record<string, unknown> | null
      telemetry?.setAcademicProfile(snapshot?.profile_draft ?? snapshot?.profile)
    } else if (method === "workspace.closeTemporary") {
      telemetry?.setAcademicProfile(null)
    }
    if (result && typeof result === "object") {
      const snapshot = result as Record<string, unknown>
      const document = (snapshot.document ?? (method === "workspace.saveDraft" || method === "workspace.createDocument" ? snapshot : null)) as Record<string, unknown> | null
      if (["workspace.open", "workspace.createProfile", "workspace.selectProfile", "workspace.deleteProfile", "workspace.restoreProfile", "workspace.selectDocument", "workspace.deleteDocument", "workspace.restoreDocument", "workspace.purgeDocument"].includes(method) || method === "workspace.closeTemporary") activeDiagnosticContext = {}
      if (document) activeDiagnosticContext = diagnosticContext({ document_type: document.document_type, structure: documentStructure(document.content) })
    }
    const envelope = isRecord(result) ? result : undefined
    const checks = Array.isArray(envelope?.checks) ? envelope.checks : []
    const failedCheck = method === "document.check"
      ? checks.find(check => isRecord(check) && check.status !== "pass")
      : undefined
    const rejected = failedCheck !== undefined || (method === "environment.check" && envelope?.ready === false)
    diagnostics?.record(
      method as DiagnosticOperation, rejected ? "failure" : "success", Date.now() - startedAt,
      isRecord(failedCheck) && typeof failedCheck.code === "string" ? failedCheck.code :
        rejected ? (method === "document.check" ? "CONTENT_CHECK_FAILED" : "ENVIRONMENT_NOT_READY") : undefined,
      {
        ...(method === "document.check" ? { stage: "content_validation" } : method === "environment.check" ? { stage: "environment_probe" } : {}),
        ...activeDiagnosticContext, request_id: requestId,
        ...diagnosticContext(isRecord(failedCheck) && isRecord(failedCheck.details) ? { field: failedCheck.details.field } : {}),
      },
    )
    return result
  } catch (error) {
    if (error instanceof SidecarError && error.diagnosticCaseId) {
      await sidecar.request("diagnostic.recover", { case_id: error.diagnosticCaseId }, 30_000).catch(() => undefined)
    }
    diagnostics?.record(
      method as DiagnosticOperation,
      error instanceof SidecarError && ["EXPORT_CANCELLED", "PREVIEW_CANCELLED", "REQUEST_CANCELLED"].includes(error.code) ? "cancelled" : "failure",
      Date.now() - startedAt,
      stableDiagnosticErrorCode(error),
      {
        ...operationContext,
        ...diagnosticContext(error instanceof SidecarError ? error.details?.diagnostic : undefined),
        ...diagnosticContext(error instanceof SidecarError ? { field: error.details?.field } : undefined),
      },
    )
    throw error
  }
}

app.enableSandbox()
app.setName(localDevelopment.dataDirectory ? "SZTU文档工作台 · 论文开发" : "SZTU文档工作台")
if (localDevelopment.dataDirectory) {
  mkdirSync(localDevelopment.dataDirectory, { recursive: true, mode: 0o700 })
  app.setPath("userData", localDevelopment.dataDirectory)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", () => {
    showMainWindow()
  })

  void app.whenReady().then(async () => {
    await registerAssetProtocol()
    configureSession()
    registerIpc()
    await initializeRemoteServices()
    if (process.platform === "darwin") {
      app.dock?.setIcon(desktopAssetPath("app-icon.png"))
    }
    mainWindow = createWindow()
    tray = createTray()

    app.on("activate", () => {
      showMainWindow()
    })
  })
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})

app.on("before-quit", (event) => {
  if (shutdownComplete) return
  event.preventDefault()
  if (!quitApproved && mainWindow && !mainWindow.isDestroyed()) {
    closeCoordinator.request(mainWindow.id, "quit")
    return
  }
  quitApproved = true
  if (shutdownStarted) return
  shutdownStarted = true
  updateService?.stop()
  midtermDatePolicyService?.stop()
  tray?.destroy()
  tray = undefined
  void Promise.all([
    sidecar?.shutdown() ?? Promise.resolve(),
    telemetry?.stop() ?? Promise.resolve(),
    diagnostics?.flush() ?? Promise.resolve(),
  ]).finally(() => {
    shutdownComplete = true
    app.quit()
  })
})
