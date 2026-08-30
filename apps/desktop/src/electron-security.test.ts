import { readFileSync, readdirSync } from "node:fs"
import { extname, join } from "node:path"
import { describe, expect, it } from "vitest"

const applicationRoot = process.cwd()
const rendererRoot = join(applicationRoot, "src")
const mainSource = readFileSync(join(applicationRoot, "electron/main.ts"), "utf8")
const preloadSource = readFileSync(
  join(applicationRoot, "electron/preload.cts"),
  "utf8",
)
const sidecarSource = readFileSync(
  join(applicationRoot, "electron/sidecar-client.ts"),
  "utf8",
)

function rendererSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = join(directory, entry.name)
    if (entry.isDirectory()) return rendererSources(target)
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [target] : []
  })
}

describe("Electron security boundary", () => {
  it("keeps BrowserWindow isolation and navigation controls enabled", () => {
    expect(mainSource).toContain("contextIsolation: true")
    expect(mainSource).toContain("nodeIntegration: false")
    expect(mainSource).toContain("sandbox: true")
    expect(mainSource).toContain("webSecurity: true")
    expect(mainSource).toContain("setWindowOpenHandler")
    expect(mainSource).toContain('on("will-navigate"')
    expect(mainSource).toContain("setPermissionRequestHandler")
  })

  it("exposes only the declared narrow preload methods", () => {
    expect(preloadSource).toContain('exposeInMainWorld("sztuDesktop"')
    for (const method of [
      "getAppInfo",
      "checkEnvironment",
      "openWorkspace",
      "saveProfile",
      "createDocument",
      "saveDraft",
      "restorePrevious",
      "closeTemporary",
      "checkDocument",
      "chooseExportDirectory",
      "preflightExport",
      "exportDocument",
      "cancelExport",
      "listExportHistory",
      "openExportArtifact",
      "installTemplatePack",
      "recordQa",
    ]) {
      expect(preloadSource).toContain(method)
    }
    expect(preloadSource).not.toMatch(/\b(?:exec|spawn|readFile|writeFile)\b/)
    expect(preloadSource).not.toContain("requestSidecar")
  })

  it("maps every workspace action to a dedicated IPC channel and validates the sender", () => {
    for (const channel of [
      "sztu:workspace-open",
      "sztu:workspace-save-profile",
      "sztu:workspace-create-document",
      "sztu:workspace-save-draft",
      "sztu:workspace-restore-previous",
      "sztu:workspace-close-temporary",
      "sztu:document-check",
      "sztu:choose-export-directory",
      "sztu:export-preflight",
      "sztu:export-document",
      "sztu:export-cancel",
      "sztu:export-history",
      "sztu:export-open-artifact",
      "sztu:template-install",
      "sztu:qa-record",
    ]) {
      expect(mainSource).toContain(`ipcMain.handle("${channel}"`)
    }
    expect(mainSource.match(/assertTrustedSender\(event\)/g)?.length).toBeGreaterThanOrEqual(17)
    expect(mainSource).toContain("assertExactKeys")
    expect(mainSource).toContain("assertJsonValue")
  })

  it("wraps the environment sidecar response in the preload bridge envelope", () => {
    expect(mainSource).toContain(
      'return runBridge(() => requestSidecar("environment.check", {}))',
    )
  })

  it("pins the sidecar template root from the main process and never logs request data", () => {
    expect(sidecarSource).toContain("SZTU_DOCS_TEMPLATE_PACKS_DIR")
    expect(sidecarSource).toContain('path.resolve(this.backendRoot, "../template-packs")')
    expect(sidecarSource).not.toContain("console.log")
  })

  it("uses an independent atomic cancellation marker instead of the blocked sidecar queue", () => {
    expect(mainSource).toContain('path.resolve(app.getPath("userData"), "cancellations")')
    expect(mainSource).toContain('flag: "wx"')
    expect(mainSource).toContain("activeCancellationFiles")
    expect(mainSource).toContain("params.cancellation_file = marker")
    expect(mainSource).toContain("overwrite_confirmed: input.overwriteConfirmed")
    expect(mainSource).toContain("preflight_token: input.preflightToken")
    expect(mainSource).toContain("app_version: app.getVersion()")
    const cancelStart = mainSource.indexOf('ipcMain.handle("sztu:export-cancel"')
    const historyStart = mainSource.indexOf('ipcMain.handle("sztu:export-history"')
    const cancelHandler = mainSource.slice(cancelStart, historyStart)
    expect(cancelHandler).not.toContain('requestSidecar("export.cancel"')
    expect(sidecarSource).not.toContain('"export.cancel"')
  })

  it("keeps artifact paths and template source paths out of renderer arguments", () => {
    expect(preloadSource).toContain(
      'openExportArtifact: (artifactId: unknown) => invoke("sztu:export-open-artifact", artifactId)',
    )
    expect(preloadSource).toContain(
      'installTemplatePack: (documentType: unknown) => invoke("sztu:template-install", documentType)',
    )
    expect(mainSource).toContain("shell.openPath")
    expect(mainSource).toContain("SHA256_PATTERN.test(resolved.sha256)")
    expect(mainSource).toContain("resolved.verified !== true")
    expect(mainSource).toContain('properties: ["openDirectory"]')
    expect(mainSource).toContain(
      '{ source_directory: sourceDirectory, document_type: documentType }',
    )
    expect(mainSource).not.toContain('{ source_path: sourcePath }')
  })

  it("does not import Node built-ins in renderer source", () => {
    for (const sourcePath of rendererSources(rendererRoot)) {
      if (sourcePath.endsWith("electron-security.test.ts")) continue
      const source = readFileSync(sourcePath, "utf8")
      expect(source, sourcePath).not.toMatch(/from ["']node:/)
      expect(source, sourcePath).not.toMatch(/\brequire\s*\(/)
    }
  })
})
