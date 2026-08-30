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
  checkEnvironment: () => invoke("sztu:environment-check"),
  openWorkspace: (mode: unknown) => invoke("sztu:workspace-open", mode),
  saveProfileDraft: (profile: unknown) =>
    invoke("sztu:workspace-save-profile-draft", profile),
  saveProfile: (profile: unknown) => invoke("sztu:workspace-save-profile", profile),
  createDocument: (document: unknown) => invoke("sztu:workspace-create-document", document),
  selectDocument: (documentId: unknown) => invoke("sztu:workspace-select-document", documentId),
  saveDraft: (input: unknown) => invoke("sztu:workspace-save-draft", input),
  closeTemporary: (documentId: unknown) => invoke("sztu:workspace-close-temporary", documentId),
  checkDocument: (documentId: unknown) => invoke("sztu:document-check", documentId),
  generatePreview: (input: unknown) => invoke("sztu:preview-generate", input),
  chooseExportDirectory: () => invoke("sztu:choose-export-directory"),
  preflightExport: (input: unknown) => invoke("sztu:export-preflight", input),
  exportDocument: (input: unknown) => invoke("sztu:export-document", input),
  cancelExport: (requestId: unknown) => invoke("sztu:export-cancel", requestId),
  listExportHistory: (input: unknown) => invoke("sztu:export-history", input),
  openExportArtifact: (artifactId: unknown) => invoke("sztu:export-open-artifact", artifactId),
  installTemplatePack: (documentType: unknown) => invoke("sztu:template-install", documentType),
  recordQa: (input: unknown) => invoke("sztu:qa-record", input),
})
