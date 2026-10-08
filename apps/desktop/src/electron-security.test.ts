import { existsSync, readFileSync, readdirSync } from "node:fs"
import { extname, join } from "node:path"
import { inflateSync } from "node:zlib"
import { describe, expect, it } from "vitest"

const applicationRoot = process.cwd()
const rendererRoot = join(applicationRoot, "src")
const themeSource = readFileSync(join(rendererRoot, "index.css"), "utf8")
const indexSource = readFileSync(join(applicationRoot, "index.html"), "utf8")
const mainSource = readFileSync(join(applicationRoot, "electron/main.ts"), "utf8")
const iconGeneratorSource = readFileSync(
  join(applicationRoot, "scripts/generate-icons.cjs"),
  "utf8",
)
const iconRendererSource = readFileSync(
  join(applicationRoot, "scripts/render-icon.cjs"),
  "utf8",
)
const preloadSource = readFileSync(
  join(applicationRoot, "electron/preload.cts"),
  "utf8",
)
const sidecarSource = readFileSync(
  join(applicationRoot, "electron/sidecar-client.ts"),
  "utf8",
)
const telemetrySource = readFileSync(
  join(applicationRoot, "electron/telemetry.ts"),
  "utf8",
)
const diagnosticsSource = readFileSync(
  join(applicationRoot, "electron/diagnostics.ts"),
  "utf8",
)
const updateSource = readFileSync(
  join(applicationRoot, "electron/update-service.ts"),
  "utf8",
)
const remoteConfigSource = readFileSync(
  join(applicationRoot, "electron/remote-services-config.ts"),
  "utf8",
)
const packagingSource = readFileSync(
  join(applicationRoot, "electron-builder.yml"),
  "utf8",
)
const packageManifest = JSON.parse(
  readFileSync(join(applicationRoot, "package.json"), "utf8"),
) as { dependencies?: Record<string, string>; scripts?: Record<string, string> }

function rendererSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = join(directory, entry.name)
    if (entry.isDirectory()) return rendererSources(target)
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [target] : []
  })
}

function pngTopLeftAlpha(filename: string): number {
  const png = readFileSync(filename)
  if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`${filename} is not a PNG image`)
  }

  const compressed: Buffer[] = []
  let bitDepth = 0
  let colorType = 0
  let offset = 8

  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.subarray(offset + 4, offset + 8).toString("ascii")
    const data = png.subarray(offset + 8, offset + 8 + length)

    if (type === "IHDR") {
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === "IDAT") {
      compressed.push(data)
    }

    offset += length + 12
    if (type === "IEND") break
  }

  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`${filename} must use 8-bit RGBA pixels`)
  }

  const scanlines = inflateSync(Buffer.concat(compressed))
  return scanlines[4]
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

  it("allows renderer-created image previews without widening executable sources", () => {
    for (const source of [indexSource, mainSource]) {
      expect(source).toContain("img-src 'self' data: blob: sztu-asset:")
      expect(source).toContain("script-src 'self'")
      expect(source).not.toContain("script-src 'self' blob:")
    }
  })

  it("uses the approved application artwork for the window, dock, and system tray", () => {
    expect(mainSource).toContain('icon: desktopAssetPath("app-icon.png")')
    expect(mainSource).toContain('app.dock?.setIcon(desktopAssetPath("app-icon.png"))')
    expect(mainSource).toContain('"trayTemplate.png"')
    expect(mainSource).toContain("trayImage.setTemplateImage(true)")
    expect(mainSource).toContain("new Tray(trayImage)")
    expect(mainSource).toContain('label: "打开 SZTU文档工作台"')
    expect(mainSource).toContain('label: "退出", role: "quit"')

    for (const asset of [
      "app-icon.svg",
      "app-icon.png",
      "tray-icon.svg",
      "trayTemplate.png",
      "trayTemplate@2x.png",
    ]) {
      expect(existsSync(join(applicationRoot, "public", asset))).toBe(true)
    }

    expect(iconGeneratorSource).toContain('require("electron")')
    expect(iconRendererSource).toContain("transparent: true")
    expect(iconRendererSource).toContain('backgroundColor: "#00000000"')
    for (const asset of [
      "app-icon.png",
      "trayTemplate.png",
      "trayTemplate@2x.png",
    ]) {
      expect(pngTopLeftAlpha(join(applicationRoot, "public", asset))).toBe(0)
    }
    const trayImage = readFileSync(
      join(applicationRoot, "public", "trayTemplate.png"),
    )
    const retinaTrayImage = readFileSync(
      join(applicationRoot, "public", "trayTemplate@2x.png"),
    )
    expect([trayImage.readUInt32BE(16), trayImage.readUInt32BE(20)]).toEqual([
      20, 20,
    ])
    expect([
      retinaTrayImage.readUInt32BE(16),
      retinaTrayImage.readUInt32BE(20),
    ]).toEqual([40, 40])
  })

  it("disables workbench motion when the operating system requests it", () => {
    expect(themeSource).toContain("@media (prefers-reduced-motion: reduce)")
    expect(themeSource).toContain('[data-slot="save-status-content"]')
    expect(themeSource).toContain('[data-slot="section-completion-mark"]')
    expect(themeSource).toContain("animation: none")
  })

  it("exposes only the declared narrow preload methods", () => {
    expect(preloadSource).toContain('exposeInMainWorld("sztuDesktop"')
    for (const method of [
      "getAppInfo",
      "checkEnvironment",
      "prepareDiagnosticReport",
      "saveDiagnosticReport",
      "sendDiagnosticReport",
      "getPrivacyNoticeStatus",
      "acceptPrivacyNotice",
      "quitApp",
      "recordTelemetry",
      "getAnonymousDocumentCount",
      "recordDocumentCompletion",
      "getUpdateStatus",
      "getMidtermDatePolicyStatus",
      "revealDownloadedUpdate",
      "openReleaseHelp",
      "openToolLink",
      "writeClipboardText",
      "writeClipboardPng",
      "onUpdateStatus",
      "onMidtermDatePolicyStatus",
      "importImageAsset",
      "openWorkspace",
      "saveProfileDraft",
      "saveProfile",
      "createDocument",
      "renameDocument",
      "deleteDocument",
      "restoreDocument",
      "purgeDocument",
      "saveDraft",
      "closeTemporary",
      "checkDocument",
      "generatePreview",
      "chooseExportDirectory",
      "preflightExport",
      "exportDocument",
      "cancelExport",
      "listExportHistory",
      "revealExportArtifact",
      "deleteExportHistory",
      "installTemplatePack",
      "recordQa",
    ]) {
      expect(preloadSource).toContain(method)
    }
    expect(preloadSource).not.toContain("restorePrevious")
    expect(preloadSource).not.toMatch(/\b(?:exec|spawn|readFile|writeFile)\b/)
    expect(preloadSource).not.toContain("requestSidecar")
  })

  it("maps every workspace action to a dedicated IPC channel and validates the sender", () => {
    for (const channel of [
      "sztu:workspace-open",
      "sztu:diagnostic-prepare",
      "sztu:diagnostic-save",
      "sztu:diagnostic-send",
      "sztu:privacy-status",
      "sztu:privacy-accept",
      "sztu:app-quit",
      "sztu:telemetry-record",
      "sztu:telemetry-completion-count",
      "sztu:telemetry-complete-document",
      "sztu:update-status",
      "sztu:update-download",
      "sztu:midterm-date-policy-status",
      "sztu:update-reveal",
      "sztu:update-open-help",
      "sztu:tool-open",
      "sztu:clipboard-write-text",
      "sztu:clipboard-write-png",
      "sztu:asset-import-image",
      "sztu:workspace-save-profile-draft",
      "sztu:workspace-save-profile",
      "sztu:workspace-create-document",
      "sztu:workspace-save-draft",
      "sztu:workspace-close-temporary",
      "sztu:document-check",
      "sztu:preview-generate",
      "sztu:choose-export-directory",
      "sztu:export-preflight",
      "sztu:export-document",
      "sztu:export-cancel",
      "sztu:export-history",
      "sztu:export-reveal-artifact",
      "sztu:export-delete-history",
      "sztu:template-install",
      "sztu:qa-record",
    ]) {
      expect(mainSource).toContain(`ipcMain.handle("${channel}"`)
    }
    for (const channel of [
      "sztu:workspace-rename-document",
      "sztu:workspace-delete-document",
      "sztu:workspace-restore-document",
      "sztu:workspace-purge-document",
    ]) {
      expect(mainSource).toContain(`"${channel}"`)
    }
    expect(mainSource).not.toContain("sztu:workspace-restore-previous")
    expect(sidecarSource).not.toContain("workspace.restorePrevious")
    expect(mainSource.match(/assertTrustedSender\(event\)/g)?.length).toBeGreaterThanOrEqual(24)
    expect(mainSource).toContain("assertExactKeys")
    expect(mainSource).toContain("assertJsonValue")
  })

  it("opens only allowlisted thesis tool links in the operating system browser", () => {
    expect(preloadSource).toContain(
      'openToolLink: (toolId: unknown) => invoke("sztu:tool-open", toolId)',
    )
    expect(mainSource).toContain("const TOOL_LINKS = {")
    expect(mainSource).toContain("Object.prototype.hasOwnProperty.call(TOOL_LINKS, toolId)")
    expect(mainSource).toContain("await shell.openExternal(TOOL_LINKS[toolId as ToolLinkId])")
    expect(mainSource).not.toContain("shell.openExternal(toolId)")
  })

  it("writes only validated text and PNG data through the native clipboard", () => {
    expect(preloadSource).toContain('writeClipboardText: (text: unknown) => invoke("sztu:clipboard-write-text", text)')
    expect(preloadSource).toContain('writeClipboardPng: (dataUrl: unknown) => invoke("sztu:clipboard-write-png", dataUrl)')
    expect(mainSource).toContain('const prefix = "data:image/png;base64,"')
    expect(mainSource).toContain('detectImageMime(bytes) !== "image/png"')
    expect(mainSource).toContain("await clipboard.writeText(text)")
    expect(mainSource).toContain("await clipboard.write([new ClipboardItem({")
    expect(mainSource).toContain('"image/png": new Blob([Uint8Array.from(bytes)]')
  })

  it("allows the shared advisor title and graduation cohort through profile IPC validation", () => {
    expect(mainSource).toContain('"advisor_title"')
    expect(mainSource).toContain('"graduation_cohort"')
    expect(mainSource).toContain(
      'assertText(value.advisor_title, "指导教师职称", 100, false)',
    )
    expect(mainSource).toContain(
      'assertText(value.graduation_cohort, "毕业届别", 20, false)',
    )
    expect(sidecarSource).toContain('"workspace.saveProfileDraft"')
  })

  it("allows the task-book document type without widening the renderer bridge", () => {
    expect(mainSource).toContain('value.document_type !== "task_book"')
    expect(mainSource).toContain('documentType !== "task_book"')
    expect(mainSource).toContain("关联包含任务书模板的本地工程")
    expect(mainSource).toContain(
      '{ source_directory: sourceDirectory, document_type: documentType }',
    )
    expect(preloadSource).toContain(
      'installTemplatePack: (documentType: unknown) => invoke("sztu:template-install", documentType)',
    )
  })

  it("wraps the environment sidecar response in the preload bridge envelope", () => {
    expect(mainSource).toContain(
      'return runBridge(checkWorkbenchEnvironment)',
    )
  })

  it("packages only compiled renderer assets and keeps Chinese and English locales", () => {
    expect(packageManifest.dependencies ?? {}).toEqual({})
    expect(packagingSource).toMatch(/electronLanguages:\s*\n\s*- en\s*\n\s*- zh_CN/)
    expect(packageManifest.scripts?.["package:mac"]).toContain(
      "verify_macos_app_bundle.mjs",
    )
  })

  it("pins the sidecar template root and explicitly allowlists its inherited environment", () => {
    expect(sidecarSource).toContain("SZTU_DOCS_TEMPLATE_PACKS_DIR")
    expect(sidecarSource).toContain("SZTU_DOCS_BUNDLED_ENGINES_DIR")
    expect(sidecarSource).toContain("SZTU_DOCS_TASK_BOOK_ENGINE_DIR")
    expect(sidecarSource).toContain("SZTU_DOCS_MIDTERM_ENGINE_DIR")
    expect(sidecarSource).toContain("SZTU_STXINGKAI_FONT")
    expect(sidecarSource).toContain('path.resolve(this.backendRoot, "../template-packs")')
    expect(sidecarSource).toContain('offlineRuntimePaths(this.backendRoot)')
    expect(sidecarSource).toContain('path.join(repositoryRoot, ".venv", "bin", "python")')
    expect(sidecarSource).toContain('path.join(repositoryRoot, ".venv", "Scripts", "python.exe")')
    const spawnEnvironment = sidecarSource.match(
      /env: \{([\s\S]*?)\n\s*\},\n\s*shell: false/,
    )?.[1]
    expect(spawnEnvironment).toBeDefined()
    expect(
      [...(spawnEnvironment?.matchAll(/process\.env\.([A-Z0-9_]+)/g) ?? [])]
        .map((match) => match[1])
        .sort(),
    ).toEqual(
        [
          "COMSPEC",
          "HOME",
          "LANG",
          "LOCALAPPDATA",
          "PROGRAMFILES",
        "LC_ALL",
        "PATHEXT",
        "SYSTEMROOT",
        "SZTU_DOCS_CJK_VALIDATOR",
        "SZTU_DOCS_MIDTERM_ENGINE_DIR",
        "SZTU_DOCS_ADVISOR_REVIEW_ENGINE_DIR",
        "SZTU_DOCS_REVIEWER_REVIEW_ENGINE_DIR",
        "SZTU_DOCS_DEFENSE_RECORD_ENGINE_DIR",
        "SZTU_DOCS_GRADE_ASSESSMENT_ENGINE_DIR",
        "SZTU_DOCS_PROPOSAL_ENGINE_DIR",
        "SZTU_DOCS_TASK_BOOK_ENGINE_DIR",
        "SZTU_FZXIAOBIAOSONG_FONT",
        "SZTU_SIMHEI_FONT",
        "SZTU_SIMSUN_FONT",
        "SZTU_STXINGKAI_FONT",
        "SZTU_TIMES_BOLD_FONT",
        "SZTU_TIMES_BOLD_ITALIC_FONT",
        "SZTU_TIMES_ITALIC_FONT",
        "SZTU_TIMES_REGULAR_FONT",
        "TEMP",
        "TMP",
        "USERPROFILE",
        "WINDIR",
      ].sort(),
    )
    expect(sidecarSource).not.toContain("console.log")
  })

  it("uses an independent atomic cancellation marker instead of the blocked sidecar queue", () => {
    expect(mainSource).toContain('path.resolve(app.getPath("userData"), "cancellations")')
    expect(mainSource).toContain('flag: "wx"')
    expect(mainSource).toContain("activeCancellationFiles")
    expect(mainSource).toContain("params.cancellation_file = marker")
    expect(mainSource).toContain("overwrite_confirmed: input.overwriteConfirmed")
    expect(mainSource).toContain("preflight_token: input.preflightToken")
    expect(mainSource).toContain("preview_id: input.previewId")
    expect(mainSource).toContain("app_version: app.getVersion()")
    const cancelStart = mainSource.indexOf('ipcMain.handle("sztu:export-cancel"')
    const historyStart = mainSource.indexOf('ipcMain.handle("sztu:export-history"')
    const cancelHandler = mainSource.slice(cancelStart, historyStart)
    expect(cancelHandler).not.toContain('requestSidecar("export.cancel"')
    expect(sidecarSource).not.toContain('"export.cancel"')
  })

  it("keeps artifact paths and template source paths out of renderer arguments", () => {
    expect(preloadSource).toContain(
      'revealExportArtifact: (artifactId: unknown) => invoke("sztu:export-reveal-artifact", artifactId)',
    )
    expect(preloadSource).toContain(
      'deleteExportHistory: (input: unknown) => invoke("sztu:export-delete-history", input)',
    )
    expect(preloadSource).toContain(
      'installTemplatePack: (documentType: unknown) => invoke("sztu:template-install", documentType)',
    )
    expect(mainSource).toContain("shell.showItemInFolder")
    expect(mainSource).toContain("SHA256_PATTERN.test(resolved.sha256)")
    expect(mainSource).toContain("resolved.verified !== true")
    expect(mainSource).toContain('properties: ["openDirectory"]')
    expect(mainSource).toContain(
      '{ source_directory: sourceDirectory, document_type: documentType }',
    )
    expect(mainSource).not.toContain('{ source_path: sourcePath }')
  })

  it("imports only verified private PNG or JPEG assets through the main process", () => {
    expect(preloadSource).toContain(
      'importImageAsset: () => invoke("sztu:asset-import-image")',
    )
    expect(mainSource).toContain("MAX_IMAGE_ASSET_BYTES = 20 * 1024 * 1024")
    expect(mainSource).toContain("fileStat.isSymbolicLink()")
    expect(mainSource).toContain("detectImageMime(bytes)")
    expect(mainSource).toContain('createHash("sha256").update(bytes).digest("hex")')
    expect(mainSource).toContain('writeFile(target, bytes, { flag: "wx", mode: 0o600 })')
    expect(mainSource).toContain('previewUrl: `sztu-asset://asset/${fileName}`')
  })

  it("serves imported assets only through the hash-bound private protocol", () => {
    expect(mainSource).toContain('scheme: "sztu-asset"')
    expect(mainSource).toContain('protocol.handle("sztu-asset"')
    expect(mainSource).toContain("MANAGED_IMAGE_NAME_PATTERN")
    expect(mainSource).toContain("digest !== match[1]")
    expect(mainSource).toContain('"Cache-Control": "private, max-age=31536000, immutable"')
  })

  it("does not import Node built-ins in renderer source", () => {
    for (const sourcePath of rendererSources(rendererRoot)) {
      if (/\.test\.tsx?$/.test(sourcePath)) continue
      const source = readFileSync(sourcePath, "utf8")
      expect(source, sourcePath).not.toMatch(/from ["']node:/)
      expect(source, sourcePath).not.toMatch(/\brequire\s*\(/)
    }
  })

  it("keeps telemetry content-free and validates signed update artifacts in the main process", () => {
    expect(telemetrySource).toContain("parseTelemetryUsageEvent")
    expect(telemetrySource).toContain("TELEMETRY_INTERVAL_MS = 30 * 60 * 1000")
    expect(telemetrySource).toContain("INSTALLATION_ID_LIFETIME_MS")
    expect(telemetrySource).toContain("STABLE_ERROR_CODE")
    expect(telemetrySource).not.toMatch(
      /studentName|student_number|thesis_title|referencesBibtex|file_path|content_hash/,
    )
    expect(updateSource).toContain('publicKey.asymmetricKeyType !== "ed25519"')
    expect(updateSource).toContain('createHash("sha256")')
    expect(updateSource).toContain("artifact.size_bytes")
    expect(updateSource).not.toContain("PRIVATE KEY")
    expect(remoteConfigSource).toContain('parsed.protocol !== "https:"')
    expect(remoteConfigSource).not.toMatch(/SecretId|SecretKey/)
    expect(diagnosticsSource).toContain("scanReport")
    expect(diagnosticsSource).toContain("MAX_OPERATION_ENTRIES = 200")
    expect(diagnosticsSource).toContain("source_fields_removed")
    expect(diagnosticsSource).toContain("full_name|student_number|thesis_title")
    expect(diagnosticsSource).toContain("thesis_title|thesis_title_en")
    expect(diagnosticsSource).toContain("scanReport(prepared.report)")
    expect(diagnosticsSource).not.toMatch(/req\.headers|process\.env|x-cloudbase-context/i)

    for (const sourcePath of rendererSources(rendererRoot)) {
      if (sourcePath.endsWith("electron-security.test.ts")) continue
      const source = readFileSync(sourcePath, "utf8")
      expect(source, sourcePath).not.toMatch(/\bfetch\s*\(/)
    }
  })
})
