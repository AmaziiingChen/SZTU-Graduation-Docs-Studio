import { existsSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"

/** Bundled tools take precedence; ordinary builds continue using the system PATH. */
export function offlineRuntimePaths(
  backendRoot: string,
  platform = process.platform,
  arch = process.arch,
  localAppData = process.env.LOCALAPPDATA,
): string[] {
  if (platform !== "win32" || arch !== "x64") return []
  let root = path.resolve(backendRoot, "../offline-runtime")
  const descriptorPath = path.resolve(backendRoot, "../offline-runtime-location.json")
  let expectedManifest: string | undefined
  if (existsSync(descriptorPath)) {
    const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8")) as Record<string, unknown>
    if (descriptor.schema_version !== "1.0" || typeof descriptor.runtime_id !== "string" ||
      !/^[a-f0-9]{64}$/.test(descriptor.runtime_id) || typeof descriptor.manifest_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(descriptor.manifest_sha256) || !localAppData) {
      throw new Error("Offline runtime location is invalid")
    }
    root = path.join(localAppData, "SZTU-Docs-Studio", "runtimes", descriptor.runtime_id)
    expectedManifest = descriptor.manifest_sha256
    if (!existsSync(path.join(root, "complete.txt"))) throw new Error("Offline runtime installation is incomplete; rerun the installer")
  }
  const manifestPath = path.join(root, "runtime-manifest.json")
  if (!existsSync(manifestPath)) {
    if (expectedManifest) throw new Error("Offline runtime installation is incomplete; rerun the installer")
    return []
  }
  const bytes = readFileSync(manifestPath)
  if (expectedManifest && createHash("sha256").update(bytes).digest("hex") !== expectedManifest) throw new Error("Offline runtime manifest integrity check failed")
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
