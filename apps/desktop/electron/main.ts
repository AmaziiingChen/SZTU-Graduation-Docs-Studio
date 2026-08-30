import { fileURLToPath } from "node:url"
import { mkdir, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  shell,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from "electron"

import {
  SidecarClient,
  SidecarError,
  type SidecarMethod,
} from "./sidecar-client.js"

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
const developmentServerUrl = "http://127.0.0.1:5173"

let mainWindow: BrowserWindow | undefined
let sidecar: SidecarClient | undefined
const approvedExportDirectories = new Set<string>()
const activeCancellationFiles = new Map<string, string>()

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
    throw new IpcValidationError("请求字段不完整或包含未支持字段。")
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
    throw new IpcValidationError(`${field} 格式无效。`)
  }
}

function assertResourceId(value: unknown, field = "documentId"): asserts value is string {
  if (typeof value !== "string" || !RESOURCE_ID_PATTERN.test(value)) {
    throw new IpcValidationError(`${field} 格式无效。`)
  }
}

function assertRequestId(value: unknown, field = "requestId"): asserts value is string {
  if (typeof value !== "string" || !REQUEST_ID_PATTERN.test(value)) {
    throw new IpcValidationError(`${field} 必须是 UUID。`)
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

async function removeCancellationMarker(marker: string): Promise<void> {
  try {
    await unlink(marker)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
}

function assertJsonValue(value: unknown, depth = 0): asserts value is JsonValue {
  if (depth > MAX_JSON_DEPTH) {
    throw new IpcValidationError("content 嵌套层级过深。")
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new IpcValidationError("content 包含无效数字。")
    return
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_COLLECTION_SIZE) throw new IpcValidationError("content 数组过大。")
    for (const item of value) assertJsonValue(item, depth + 1)
    return
  }
  if (!isRecord(value)) throw new IpcValidationError("content 必须是 JSON 数据。")
  const entries = Object.entries(value)
  if (entries.length > MAX_JSON_COLLECTION_SIZE) throw new IpcValidationError("content 对象过大。")
  for (const [key, item] of entries) {
    if (!key || key.length > 128 || ["__proto__", "constructor", "prototype"].includes(key)) {
      throw new IpcValidationError("content 包含无效字段名。")
    }
    assertJsonValue(item, depth + 1)
  }
}

function assertProfile(value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new IpcValidationError("profile 必须是对象。")
  assertExactKeys(
    value,
    ["full_name", "student_number", "college", "major"],
    ["id", "class_name", "advisor_name"],
  )
  if (value.id !== undefined) assertResourceId(value.id, "profile.id")
  assertText(value.full_name, "profile.full_name", 100)
  assertText(value.student_number, "profile.student_number", 64)
  assertText(value.college, "profile.college", 200)
  assertText(value.major, "profile.major", 200)
  assertText(value.class_name, "profile.class_name", 100, false)
  assertText(value.advisor_name, "profile.advisor_name", 100, false)
}

function assertDocument(value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new IpcValidationError("document 必须是对象。")
  assertExactKeys(
    value,
    ["document_type", "template_version", "schema_version", "title"],
    ["profile_id"],
  )
  if (value.profile_id !== undefined && value.profile_id !== null) {
    assertResourceId(value.profile_id, "document.profile_id")
  }
  if (value.document_type !== "proposal" && value.document_type !== "midterm") {
    throw new IpcValidationError("document.document_type 暂不支持。")
  }
  assertText(value.template_version, "document.template_version", 64)
  assertText(value.schema_version, "document.schema_version", 64)
  assertText(value.title, "document.title", 240)
}

function assertExportFormats(value: unknown): asserts value is Array<"docx" | "pdf" | "tex"> {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 3 ||
    new Set(value).size !== value.length ||
    !value.every((format) => format === "docx" || format === "pdf" || format === "tex")
  ) {
    throw new IpcValidationError("formats 必须从 Word、PDF、LaTeX 中选择一到三项。")
  }
}

function bridgeFailure(error: unknown): BridgeResponse<never> {
  if (error instanceof SidecarError || error instanceof IpcValidationError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error instanceof SidecarError && error.details ? { details: error.details } : {}),
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
      : "'self' http://127.0.0.1:5173 ws://127.0.0.1:5173"
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src ${connectSources}`,
        ],
      },
    })
  })
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    webPreferences: {
      preload: path.join(moduleDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (!urlIsTrusted(targetUrl)) {
      event.preventDefault()
    }
  })

  window.once("ready-to-show", () => window.show())
  if (app.isPackaged) {
    void window.loadFile(path.join(moduleDirectory, "../dist/index.html"))
  } else {
    void window.loadURL(developmentServerUrl)
  }

  return window
}

function registerIpc(): void {
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
    return runBridge(() => requestSidecar("environment.check", {}))
  })

  ipcMain.handle("sztu:workspace-open", async (event, mode: unknown) => {
    assertTrustedSender(event)
    return runBridge(() => {
      if (mode !== "persistent" && mode !== "temporary") {
        throw new IpcValidationError("mode 必须是 persistent 或 temporary。")
      }
      return requestSidecar("workspace.open", { mode })
    })
  })

  ipcMain.handle("sztu:workspace-save-profile", async (event, profile: unknown) => {
    assertTrustedSender(event)
    return runBridge(() => {
      assertProfile(profile)
      return requestSidecar("workspace.saveProfile", { profile })
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

  ipcMain.handle("sztu:workspace-save-draft", async (event, input: unknown) => {
    assertTrustedSender(event)
    return runBridge(() => {
      if (!isRecord(input)) throw new IpcValidationError("保存草稿参数必须是对象。")
      assertExactKeys(input, ["documentId", "content", "expectedRevision"], ["reason"])
      assertResourceId(input.documentId)
      if (!isRecord(input.content)) throw new IpcValidationError("content 必须是对象。")
      assertJsonValue(input.content)
      if (!Number.isInteger(input.expectedRevision) || (input.expectedRevision as number) < 0) {
        throw new IpcValidationError("expectedRevision 必须是非负整数。")
      }
      if (input.reason !== undefined && input.reason !== "auto" && input.reason !== "manual") {
        throw new IpcValidationError("reason 必须是 auto 或 manual。")
      }
      return requestSidecar<Record<string, unknown>>("workspace.saveDraft", {
        document_id: input.documentId,
        content: input.content,
        expected_revision: input.expectedRevision,
        reason: input.reason ?? "auto",
      }).then((document) => {
        assertResourceId(document.id, "result.id")
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

  ipcMain.handle("sztu:workspace-restore-previous", async (event, input: unknown) => {
    assertTrustedSender(event)
    return runBridge(() => {
      if (!isRecord(input)) throw new IpcValidationError("恢复参数必须是对象。")
      assertExactKeys(input, ["documentId", "expectedRevision"])
      assertResourceId(input.documentId)
      if (!Number.isInteger(input.expectedRevision) || (input.expectedRevision as number) < 0) {
        throw new IpcValidationError("expectedRevision 必须是非负整数。")
      }
      return requestSidecar("workspace.restorePrevious", {
        document_id: input.documentId,
        expected_revision: input.expectedRevision,
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
      if (!isRecord(input)) throw new IpcValidationError("导出预检参数必须是对象。")
      assertExactKeys(input, ["documentId", "outputDirectory", "formats"])
      assertResourceId(input.documentId)
      assertExportFormats(input.formats)
      assertText(input.outputDirectory, "outputDirectory", 4096)
      if (!path.isAbsolute(input.outputDirectory as string)) {
        throw new IpcValidationError("outputDirectory 必须是绝对路径。")
      }
      const outputDirectory = path.resolve(input.outputDirectory as string)
      if (!approvedExportDirectories.has(outputDirectory)) {
        throw new IpcValidationError("输出目录必须通过系统文件夹选择器确认。")
      }
      const params: Record<string, unknown> = {
        document_id: input.documentId,
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
        ["requestId", "documentId", "outputDirectory", "formats", "preflightToken", "overwriteConfirmed"],
      )
      assertRequestId(input.requestId)
      assertResourceId(input.documentId)
      assertText(input.outputDirectory, "outputDirectory", 4096)
      if (!path.isAbsolute(input.outputDirectory as string)) {
        throw new IpcValidationError("outputDirectory 必须是绝对路径。")
      }
      const outputDirectory = path.resolve(input.outputDirectory as string)
      if (!approvedExportDirectories.delete(outputDirectory)) {
        throw new IpcValidationError("输出目录必须通过系统文件夹选择器确认。")
      }
      assertExportFormats(input.formats)
      if (typeof input.overwriteConfirmed !== "boolean") {
        throw new IpcValidationError("overwriteConfirmed 必须是布尔值。")
      }
      if (typeof input.preflightToken !== "string" || !SHA256_PATTERN.test(input.preflightToken)) {
        throw new IpcValidationError("preflightToken 格式无效。")
      }
      const params: Record<string, unknown> = {
        request_id: input.requestId,
        document_id: input.documentId,
        output_directory: outputDirectory,
        formats: input.formats,
        preflight_token: input.preflightToken,
        overwrite_confirmed: input.overwriteConfirmed,
        app_version: app.getVersion(),
      }
      if (activeCancellationFiles.has(input.requestId)) {
        throw new IpcValidationError("同一 requestId 已有导出任务正在运行。")
      }
      const marker = cancellationPath(input.requestId)
      return mkdir(path.dirname(marker), { recursive: true, mode: 0o700 })
        .then(() => removeCancellationMarker(marker))
        .then(() => {
          activeCancellationFiles.set(input.requestId as string, marker)
          params.cancellation_file = marker
          return requestSidecar("export.run", params, 120_000)
        })
        .finally(async () => {
          activeCancellationFiles.delete(input.requestId as string)
          await removeCancellationMarker(marker)
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
      if (!isRecord(input)) throw new IpcValidationError("导出历史参数必须是对象。")
      assertExactKeys(input, ["documentId"], ["limit"])
      assertResourceId(input.documentId)
      const params: Record<string, unknown> = { document_id: input.documentId }
      if (input.limit !== undefined) {
        if (!Number.isInteger(input.limit) || (input.limit as number) < 1 || (input.limit as number) > 100) {
          throw new IpcValidationError("limit 必须是 1 到 100 的整数。")
        }
        params.limit = input.limit
      }
      return requestSidecar("export.history", params, 15_000)
    })
  })

  ipcMain.handle("sztu:export-open-artifact", async (event, artifactId: unknown) => {
    assertTrustedSender(event)
    return runBridge(async () => {
      assertResourceId(artifactId, "artifactId")
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
      assertResourceId(resolved.artifact_id, "result.artifact_id")
      assertText(resolved.absolute_path, "result.absolute_path", 4096)
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
      const applicationError = await shell.openPath(resolved.absolute_path as string)
      return applicationError
        ? { artifact_id: artifactId, opened: false, application_error: "无法使用默认应用打开该产物。" }
        : { artifact_id: artifactId, opened: true }
    })
  })

  ipcMain.handle("sztu:template-install", async (event, documentType: unknown) => {
    assertTrustedSender(event)
    return runBridge(async () => {
      if (documentType !== "proposal" && documentType !== "midterm") {
        throw new IpcValidationError("documentType 必须是 proposal 或 midterm。")
      }
      const options: OpenDialogOptions = {
        title:
          documentType === "midterm"
            ? "选择包含中期检查模板的项目根目录"
            : "选择受信任开题报告模板引擎目录",
        buttonLabel: "验证并安装",
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
      if (!isRecord(input)) throw new IpcValidationError("QA 记录参数必须是对象。")
      assertExactKeys(input, ["gate", "status", "message"], ["exportId", "artifactId", "editor"])
      if (input.exportId !== undefined) assertResourceId(input.exportId, "exportId")
      if (input.artifactId !== undefined) assertResourceId(input.artifactId, "artifactId")
      if (input.gate !== "full_page_layout" && input.gate !== "target_editor") {
        throw new IpcValidationError("gate 仅允许逐页版式或目标编辑器验收。")
      }
      if (input.status !== "pass" && input.status !== "fail") {
        throw new IpcValidationError("status 必须是 pass 或 fail。")
      }
      if (input.gate === "target_editor") {
        if (
          input.artifactId === undefined ||
          (input.editor !== "word" && input.editor !== "wps")
        ) {
          throw new IpcValidationError("目标编辑器验收必须指定 Word 产物和 Word/WPS。")
        }
      } else if (input.editor !== undefined) {
        throw new IpcValidationError("逐页版式记录不得声明 editor。")
      } else if (input.exportId === undefined) {
        throw new IpcValidationError("逐页版式验收必须指定导出记录。")
      }
      assertText(input.message, "message", 1000)
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

function requestSidecar<T>(
  method: SidecarMethod,
  params: Record<string, unknown>,
  timeoutMs?: number,
): Promise<T> {
  sidecar ??= new SidecarClient(backendRoot(), app.getPath("userData"))
  return sidecar.request<T>(method, params, timeoutMs)
}

app.enableSandbox()

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(() => {
    configureSession()
    registerIpc()
    mainWindow = createWindow()

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow()
      }
    })
  })
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})

app.on("before-quit", () => {
  sidecar?.dispose()
})
