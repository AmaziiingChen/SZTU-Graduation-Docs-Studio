import { contextBridge, ipcRenderer } from "electron"

type BridgeResponse<T> =
  | { ok: true; result: T }
  | {
      ok: false
      error: {
        code: string
        message: string
        details?: Record<string, unknown>
      }
    }

class DesktopApiError extends Error {
  readonly code: string
  readonly details?: Record<string, unknown>

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(`${code}: ${message}`)
    this.name = "DesktopApiError"
    this.code = code
    this.details = details
  }
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const response = (await ipcRenderer.invoke(channel, ...args)) as BridgeResponse<T>
  if (!response || typeof response !== "object" || typeof response.ok !== "boolean") {
    throw new DesktopApiError("INVALID_MAIN_RESPONSE", "桌面主进程返回了无效结果。")
  }
  if (response.ok) return response.result
  throw new DesktopApiError(response.error.code, response.error.message, response.error.details)
}

contextBridge.exposeInMainWorld("sztuDesktop", {
  getAppInfo: () => invoke("sztu:app-info"),
  downloadThesisTemplate: () => invoke("sztu:thesis-template-download"),
  checkEnvironment: () => invoke("sztu:environment-check"),
  prepareDiagnosticReport: () => invoke("sztu:diagnostic-prepare"),
  saveDiagnosticReport: (reportId: unknown) =>
    invoke("sztu:diagnostic-save", reportId),
  sendDiagnosticReport: (reportId: unknown) =>
    invoke("sztu:diagnostic-send", reportId),
  getPrivacyNoticeStatus: () => invoke("sztu:privacy-status"),
  acceptPrivacyNotice: () => invoke("sztu:privacy-accept"),
  quitApp: () => invoke("sztu:app-quit"),
  onCloseRequest: (callback: unknown) => {
    if (typeof callback !== "function") {
      throw new DesktopApiError("INVALID_CALLBACK", "关闭请求监听器必须是函数。")
    }
    const listener = (_event: Electron.IpcRendererEvent, requestId: unknown) => {
      if (typeof requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return
      callback(requestId)
    }
    ipcRenderer.on("sztu:close-request", listener)
    return () => ipcRenderer.removeListener("sztu:close-request", listener)
  },
  completeCloseRequest: (input: unknown) => invoke<{ accepted: boolean }>("sztu:close-complete", input),
  recordTelemetry: (input: unknown) => invoke("sztu:telemetry-record", input),
  getAnonymousDocumentCount: () => invoke("sztu:telemetry-completion-count"),
  recordDocumentCompletion: (input: unknown) =>
    invoke("sztu:telemetry-complete-document", input),
  getUpdateStatus: () => invoke("sztu:update-status"),
  downloadUpdate: () => invoke("sztu:update-download"),
  getMidtermDatePolicyStatus: () => invoke("sztu:midterm-date-policy-status"),
  revealDownloadedUpdate: () => invoke("sztu:update-reveal"),
  openReleaseHelp: () => invoke("sztu:update-open-help"),
  openToolLink: (toolId: unknown) => invoke("sztu:tool-open", toolId),
  writeClipboardText: (text: unknown) => invoke("sztu:clipboard-write-text", text),
  writeClipboardPng: (dataUrl: unknown) => invoke("sztu:clipboard-write-png", dataUrl),
  importImageAssets: () => invoke("sztu:asset-import-images"),
  importImageAsset: () => invoke("sztu:asset-import-image"),
  readImageAssetPreview: (fileName: unknown) => invoke("sztu:asset-preview-data", fileName),
  onUpdateStatus: (callback: unknown) => {
    if (typeof callback !== "function") {
      throw new DesktopApiError("INVALID_CALLBACK", "更新状态监听器必须是函数。")
    }
    const listener = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status)
    ipcRenderer.on("sztu:update-status", listener)
    return () => ipcRenderer.removeListener("sztu:update-status", listener)
  },
  onMidtermDatePolicyStatus: (callback: unknown) => {
    if (typeof callback !== "function") {
      throw new DesktopApiError("INVALID_CALLBACK", "日期规则监听器必须是函数。")
    }
    const listener = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status)
    ipcRenderer.on("sztu:midterm-date-policy-status", listener)
    return () => ipcRenderer.removeListener("sztu:midterm-date-policy-status", listener)
  },
  openWorkspace: (mode: unknown) => invoke("sztu:workspace-open", mode),
  listDocuments: (input: unknown) => invoke("sztu:workspace-list-documents", input),
  saveProfileDraft: (profile: unknown) =>
    invoke("sztu:workspace-save-profile-draft", profile),
  saveProfile: (profile: unknown) => invoke("sztu:workspace-save-profile", profile),
  createDocument: (document: unknown) => invoke("sztu:workspace-create-document", document),
  selectDocument: (documentId: unknown) => invoke("sztu:workspace-select-document", documentId),
  renameDocument: (input: unknown) => invoke("sztu:workspace-rename-document", input),
  deleteDocument: (documentId: unknown) => invoke("sztu:workspace-delete-document", documentId),
  restoreDocument: (documentId: unknown) => invoke("sztu:workspace-restore-document", documentId),
  purgeDocument: (documentId: unknown) => invoke("sztu:workspace-purge-document", documentId),
  saveDraft: (input: unknown) => invoke("sztu:workspace-save-draft", input),
  closeTemporary: (documentId: unknown) => invoke("sztu:workspace-close-temporary", documentId),
  checkDocument: (documentId: unknown) => invoke("sztu:document-check", documentId),
  generatePreview: (input: unknown) => invoke("sztu:preview-generate", input),
  chooseExportDirectory: () => invoke("sztu:choose-export-directory"),
  preflightExport: (input: unknown) => invoke("sztu:export-preflight", input),
  exportDocument: (input: unknown) => invoke("sztu:export-document", input),
  cancelExport: (requestId: unknown) => invoke("sztu:export-cancel", requestId),
  listExportHistory: (input: unknown) => invoke("sztu:export-history", input),
  revealExportArtifact: (artifactId: unknown) => invoke("sztu:export-reveal-artifact", artifactId),
  deleteExportHistory: (input: unknown) => invoke("sztu:export-delete-history", input),
  installTemplatePack: (documentType: unknown) => invoke("sztu:template-install", documentType),
  recordQa: (input: unknown) => invoke("sztu:qa-record", input),
})
