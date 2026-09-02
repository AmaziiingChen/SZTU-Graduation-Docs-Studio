const { spawnSync } = require("node:child_process")
const path = require("node:path")

const electronPath = require("electron")
const applicationRoot = path.resolve(__dirname, "..")
const publicRoot = path.join(applicationRoot, "public")
const workerPath = path.join(__dirname, "render-icon.cjs")
const icons = [
  ["app-icon.svg", "app-icon.png", 1024],
  ["tray-icon.svg", "trayTemplate.png", 20],
  ["tray-icon.svg", "trayTemplate@2x.png", 40],
]

for (const [sourceName, outputName, size] of icons) {
  const result = spawnSync(
    electronPath,
    [
      workerPath,
      path.join(publicRoot, sourceName),
      path.join(publicRoot, outputName),
      String(size),
    ],
    { stdio: "inherit" },
  )

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
