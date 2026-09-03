import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const source = path.join(root, "apps", "desktop", "public", "app-icon.png")
const buildRoot = path.join(root, "apps", "desktop", "build")
const iconset = path.join(buildRoot, "icon.iconset")
const output = path.join(buildRoot, "icon.icns")

rmSync(iconset, { recursive: true, force: true })
mkdirSync(iconset, { recursive: true })

for (const size of [16, 32, 128, 256, 512]) {
  const regular = path.join(iconset, `icon_${size}x${size}.png`)
  const retina = path.join(iconset, `icon_${size}x${size}@2x.png`)
  execFileSync("sips", ["-z", String(size), String(size), source, "--out", regular], {
    stdio: "ignore",
  })
  execFileSync("sips", ["-z", String(size * 2), String(size * 2), source, "--out", retina], {
    stdio: "ignore",
  })
}
cpSync(source, path.join(iconset, "icon_512x512@2x.png"))
execFileSync("iconutil", ["-c", "icns", iconset, "-o", output], { stdio: "inherit" })
rmSync(iconset, { recursive: true, force: true })
console.log(`macOS icon is ready: ${output}`)
