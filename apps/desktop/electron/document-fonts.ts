import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

// Resolved lazily so tests that mock node:child_process (sidecar lifecycle)
// can import this module without providing execFile.
async function runRegCommand(args: string[]): Promise<void> {
  const { execFile } = await import("node:child_process")
  await promisify(execFile)("reg.exe", args, { windowsHide: true })
}

const WINDOWS_FONT_REGISTRY_KEY = String.raw`HKCU\Software\Microsoft\Windows NT\CurrentVersion\Fonts`
const FONT_FILE_PATTERN = /\.(ttf|ttc|otf)$/i

/** Private fonts serve renderers directly; they need not be registered in the OS. */
export function documentFontDirectories(backendRoot: string, configured = process.env.SZTU_FONT_DIR): string | undefined {
  const roots = configured?.split(path.delimiter).filter(Boolean) ?? []
  for (const folder of ["document-fonts", "local-fonts"]) {
    const candidate = path.resolve(backendRoot, "..", folder)
    if (existsSync(candidate)) roots.push(candidate)
  }
  return roots.length ? [...new Set(roots)].join(path.delimiter) : undefined
}

/** 随包分发的字体文件夹，顺序与 documentFontDirectories 一致。 */
export function shippedDocumentFontDirectories(backendRoot: string): string[] {
  return (documentFontDirectories(backendRoot, "") ?? "").split(path.delimiter).filter(Boolean)
}

export interface DocumentFontInstallResult {
  directory: string | undefined
  registered: string[]
  failed: string[]
}

export interface DocumentFontInstallOptions {
  platform?: NodeJS.Platform
  localAppData?: string
  copyFile?: (source: string, destination: string) => void
  runReg?: (args: string[]) => Promise<void>
}

function currentUserFontsDirectory(localAppData?: string): string {
  const base = localAppData ?? process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local")
  return path.join(base, "Microsoft", "Windows", "Fonts")
}

function fontRegistryValueName(fileName: string): string {
  return `${path.basename(fileName, path.extname(fileName))} (TrueType)`
}

/**
 * 把随包字体注册到当前 Windows 用户的字体目录与 HKCU 注册表。
 *
 * - 只写当前用户，不需要管理员权限；
 * - 复制前比较大小，已存在同尺寸文件时不重复写；
 * - 任何单个字体失败只记录，不阻塞应用启动（Word/WPS 之外的渲染仍可直接读字体文件）。
 */
export async function registerWindowsDocumentFonts(
  backendRoot: string,
  options: DocumentFontInstallOptions = {},
): Promise<DocumentFontInstallResult> {
  const platform = options.platform ?? process.platform
  const result: DocumentFontInstallResult = { directory: undefined, registered: [], failed: [] }
  if (platform !== "win32") return result
  const sources = shippedDocumentFontDirectories(backendRoot)
  if (!sources.length) return result
  const directory = currentUserFontsDirectory(options.localAppData)
  result.directory = directory
  try {
    mkdirSync(directory, { recursive: true })
  } catch (error) {
    result.failed.push(`${directory}: ${String(error)}`)
    return result
  }
  const copyFile = options.copyFile ?? ((source: string, destination: string) => copyFileSync(source, destination))
  const runReg = options.runReg ?? runRegCommand
  for (const source of sources) {
    if (!existsSync(source)) continue
    let entries: string[]
    try {
      entries = readdirSync(source)
    } catch {
      continue
    }
    for (const entry of entries.filter((name) => FONT_FILE_PATTERN.test(name)).sort()) {
      const original = path.join(source, entry)
      const destination = path.join(directory, entry)
      try {
        if (!existsSync(destination) || statSync(destination).size !== statSync(original).size) {
          copyFile(original, destination)
        }
        await runReg(["add", WINDOWS_FONT_REGISTRY_KEY, "/v", fontRegistryValueName(entry), "/t", "REG_SZ", "/d", destination, "/f"])
        result.registered.push(entry)
      } catch (error) {
        result.failed.push(`${entry}: ${String(error)}`)
      }
    }
  }
  return result
}
