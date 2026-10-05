import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const desktopRequire = createRequire(path.join(root, "apps/desktop/package.json"))
const builderRequire = createRequire(desktopRequire.resolve("electron-builder"))
const appBuilderRequire = createRequire(builderRequire.resolve("app-builder-lib"))
const { extractFile } = appBuilderRequire("@electron/asar")

export function verifyThesisTemplateResource(archivePath) {
  const prefix = path.join("resources", "thesis-template")
  const metadata = JSON.parse(extractFile(archivePath, path.join(prefix, "sztu-thesis-2026.json")).toString("utf8"))
  const bytes = extractFile(archivePath, path.join(prefix, "sztu-thesis-2026.zip"))
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  if (metadata.filename !== "sztu-thesis-2026.zip" || bytes.length > 10 * 1024 * 1024
    || bytes.subarray(0, 4).toString("hex") !== "504b0304"
    || metadata.sizeBytes !== bytes.length || metadata.sha256 !== sha256) {
    throw new Error("Bundled thesis download resource failed integrity verification")
  }
  return { status: "pass", version: metadata.version, sizeBytes: bytes.length, sha256 }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("Pass the packaged app.asar path")
  console.log(JSON.stringify(verifyThesisTemplateResource(path.resolve(process.argv[2])), null, 2))
}
