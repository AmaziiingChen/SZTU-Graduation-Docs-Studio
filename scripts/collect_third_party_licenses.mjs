// Collect the production dependency licenses into build/third-party-licenses.
// The offline installer ships this inventory next to LICENSE and NOTICE; the
// Electron and Chromium license texts are written by electron-builder itself.
import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const output = path.join(root, "build", "third-party-licenses")
const pnpm = process.env.npm_execpath
if (!pnpm) throw new Error("Run this script through pnpm so npm_execpath is set.")

const result = spawnSync(process.execPath, [pnpm, "licenses", "list", "--prod", "--json"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
})
if (result.status !== 0) {
  process.stderr.write(result.stderr || "")
  process.exit(result.status ?? 1)
}

const groups = JSON.parse(result.stdout)
const sections = Object.keys(groups).sort((left, right) => left.localeCompare(right))
const rows = []
let packageCount = 0
for (const license of sections) {
  const packages = groups[license]
    .map((entry) => {
      const versions = [...new Set(entry.versions ?? [])].sort()
      return versions.map((version) => `${entry.name}@${version}`).join(", ")
    })
    .sort((left, right) => left.localeCompare(right))
  packageCount += packages.length
  rows.push(`## ${license}\n\n${packages.map((item) => `- ${item}`).join("\n")}`)
}

const document = `# 第三方组件许可清单

本文件由 \`scripts/collect_third_party_licenses.mjs\` 根据 \`pnpm-lock.yaml\` 的生产依赖自动生成。
共 ${packageCount} 个 npm 包，按许可证分组。

Electron 与 Chromium 的完整许可证文本由 electron-builder 随安装包写入程序目录；
Python 引擎的依赖与许可证见 \`backend/pyproject.toml\` 与各包的 \`dist-info\`。
字体文件的版权与再分发说明见安装目录中的 \`NOTICE\`。

${rows.join("\n\n")}
`

mkdirSync(output, { recursive: true })
writeFileSync(path.join(output, "index.md"), document, "utf8")
console.log(`third-party licenses: ${packageCount} packages -> build/third-party-licenses/index.md`)
