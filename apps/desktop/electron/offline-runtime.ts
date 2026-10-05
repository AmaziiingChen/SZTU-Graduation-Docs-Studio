import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

/** Bundled tools take precedence; ordinary builds continue using the system PATH. */
export function offlineRuntimePaths(
  backendRoot: string,
  platform = process.platform,
  arch = process.arch,
): string[] {
  if (platform !== "win32" || arch !== "x64") return []
  const root = path.resolve(backendRoot, "../offline-runtime")
  const manifestPath = path.join(root, "runtime-manifest.json")
  if (!existsSync(manifestPath)) return []
  const bytes = readFileSync(manifestPath)
  if (bytes.length > 262_144) throw new Error("Offline runtime manifest is too large")
  const manifest = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>
  if (manifest.schema_version !== "1.0" || manifest.platform !== "win32" || manifest.architecture !== "x64") {
    throw new Error("Offline runtime target does not match this application")
  }
  const directories = [path.join(root, "texlive", "bin", "windows"), path.join(root, "poppler", "Library", "bin")] as const
  for (const [directory, executable] of [[directories[0], "xelatex.exe"], [directories[1], "pdftoppm.exe"]] as const) {
    if (!existsSync(path.join(directory, executable))) throw new Error("Offline runtime is incomplete")
  }
  return [...directories]
}
