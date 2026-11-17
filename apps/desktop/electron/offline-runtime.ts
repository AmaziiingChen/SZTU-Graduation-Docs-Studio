import { existsSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"

/** Windows and TeX Live only exchange paths reliably when every byte is ASCII. */
const ASCII_PATH = /^[\x20-\x7e]+$/

const INCOMPLETE = "Offline runtime installation is incomplete; rerun the installer"
const UNSUPPORTED_PATH = "Offline runtime is installed outside an ASCII path; rerun the installer"

type Descriptor = Record<string, unknown>
type Root = {kind: "env", name: string} | {kind: "path", value: string}

function expand(value: string, environment: NodeJS.ProcessEnv, variables: Record<string, string | undefined>): string | undefined {
  const replaced = value.replace(/%([^%]+)%/g, (match, name: string) => {
    const replacement = variables[name.toUpperCase()] ?? environment[name] ?? environment[name.toUpperCase()]
    return replacement ?? match
  })
  // An unresolved variable would silently point at nothing; refuse the candidate instead.
  if (/%[^%]+%/.test(replaced) || !path.isAbsolute(replaced)) return undefined
  return path.normalize(replaced)
}

function rootCandidates(descriptor: Descriptor, localAppData: string | undefined, programData: string | undefined, environment: NodeJS.ProcessEnv): string[] {
  const roots = descriptor.roots
  if (!Array.isArray(roots) || roots.length === 0) throw new Error("Offline runtime location is invalid")
  const variables = { PROGRAMDATA: programData, LOCALAPPDATA: localAppData, PROGRAMFILES: environment.PROGRAMFILES }
  const candidates: string[] = []
  for (const entry of roots as Root[]) {
    if (entry?.kind === "env" && typeof entry.name === "string") {
      const value = environment[entry.name]
      if (value && path.isAbsolute(value)) candidates.push(path.normalize(value))
      continue
    }
    if (entry?.kind === "path" && typeof entry.value === "string") {
      const expanded = expand(entry.value, environment, variables)
      if (expanded) candidates.push(expanded)
      continue
    }
    throw new Error("Offline runtime location is invalid")
  }
  return candidates
}

/** A candidate is usable only when the installer finished it and the path stays ASCII. */
function evaluate(root: string, expectedManifest: string | undefined, runtimeId: string) {
  const marker = path.join(root, "complete.txt")
  const complete = existsSync(marker) && readFileSync(marker, "utf8") === runtimeId
  if (!complete) return {root, usable: false, reason: "incomplete" as const}
  if (!ASCII_PATH.test(root)) return {root, usable: false, reason: "unsupported-path" as const}
  if (expectedManifest !== undefined) {
    const manifestPath = path.join(root, "runtime-manifest.json")
    if (!existsSync(manifestPath)) return {root, usable: false, reason: "incomplete" as const}
    if (createHash("sha256").update(readFileSync(manifestPath)).digest("hex") !== expectedManifest) {
      return {root, usable: false, reason: "integrity" as const}
    }
  }
  return {root, usable: true, reason: "usable" as const}
}

/** Bundled tools take precedence; ordinary builds continue using the system PATH. */
export function offlineRuntimePaths(
  backendRoot: string,
  platform = process.platform,
  arch = process.arch,
  localAppData = process.env.LOCALAPPDATA,
  programData = process.env.ProgramData,
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  if (platform !== "win32" || arch !== "x64") return []
  let root = path.resolve(backendRoot, "../offline-runtime")
  const descriptorPath = path.resolve(backendRoot, "../offline-runtime-location.json")
  let expectedManifest: string | undefined
  if (existsSync(descriptorPath)) {
    const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8")) as Descriptor
    const runtimeId = descriptor.runtime_id
    if (!["1.0", "2.0", "3.0"].includes(String(descriptor.schema_version)) || typeof runtimeId !== "string" ||
      !/^[a-f0-9]{64}$/.test(runtimeId) || typeof descriptor.manifest_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(descriptor.manifest_sha256)) {
      throw new Error("Offline runtime location is invalid")
    }
    expectedManifest = descriptor.manifest_sha256
    if (descriptor.schema_version === "3.0") {
      // Ordered fallback chain: a per-machine engine first, then the legacy per-user copy.
      const outcomes = rootCandidates(descriptor, localAppData, programData, environment).map((candidate) => evaluate(candidate, expectedManifest, runtimeId))
      const usable = outcomes.find((outcome) => outcome.usable)
      if (!usable) {
        // A completed runtime that sits in a non-ASCII path is the reported 0.1.15 failure; name it
        // instead of falling back to a generic "incomplete" message the user cannot act on.
        if (outcomes.some((outcome) => outcome.reason === "unsupported-path")) throw new Error(UNSUPPORTED_PATH)
        if (outcomes.some((outcome) => outcome.reason === "integrity")) throw new Error("Offline runtime manifest integrity check failed")
        throw new Error(INCOMPLETE)
      }
      root = usable.root
    } else {
      if (!localAppData) throw new Error("Offline runtime location is invalid")
      root = descriptor.schema_version === "2.0"
        ? path.join(localAppData, "SZTU-Docs", "r", runtimeId.slice(0, 16))
        : path.join(localAppData, "SZTU-Docs-Studio", "runtimes", runtimeId)
      if (!existsSync(path.join(root, "complete.txt")) || readFileSync(path.join(root, "complete.txt"), "utf8") !== runtimeId) throw new Error(INCOMPLETE)
    }
  }
  const manifestPath = path.join(root, "runtime-manifest.json")
  if (!existsSync(manifestPath)) {
    if (expectedManifest) throw new Error(INCOMPLETE)
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
