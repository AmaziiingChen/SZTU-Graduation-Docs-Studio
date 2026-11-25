import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("Windows packaging currently requires Windows x64.")
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const python = path.join(root, ".venv", "Scripts", "python.exe")
const pnpmScript = process.env.npm_execpath
const offline = process.argv.includes("--offline")
if (offline && !existsSync(path.join(root, "build/offline-runtime/runtime-manifest.json"))) {
  throw new Error("Prepare build/offline-runtime with scripts/stage_windows_offline_runtime.py first.")
}
if (!pnpmScript) throw new Error("Run this script with pnpm package:win.")
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root, stdio: "inherit", windowsHide: true,
    env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
// Electron 44 downloads its binary on demand, not during dependency installation.
// A clean Windows host must prepare it before the explicit electronDist check below.
run(process.execPath, [pnpmScript, "--filter", "@sztu-docs/desktop", "exec", "install-electron"])
run("python", ["scripts/setup_backend_runtime.py"])
run(python, ["scripts/stage_macos_template_engines.py", "--check"])
if (offline) run(python, ["scripts/verify_windows_offline_runtime.py", "build/offline-runtime"])
if (offline) run(python, ["scripts/prepare_windows_runtime_installer.py"])
run(python, ["-m", "pip", "install", "--disable-pip-version-check", "-r", "scripts/requirements-packaging.txt"])
run(process.execPath, [pnpmScript, "verify"])
run(python, ["scripts/stage_thesis_template.py"])
run(python, ["scripts/stage_document_fonts.py"])
run(python, ["scripts/build_backend_sidecar.py"])
run(python, ["scripts/stage_macos_template_engines.py"])
run(python, ["scripts/generate_windows_icon.py"])
const electronDist = path.join(root, "apps/desktop/node_modules/electron/dist")
if (!existsSync(path.join(electronDist, "electron.exe"))) throw new Error("Install the project's Electron dependency before packaging.")
run(process.execPath, [pnpmScript, "--filter", "@sztu-docs/desktop", offline ? "package:win:offline" : "package:win", `--config.electronDist=${electronDist}`])
run(python, ["scripts/verify_windows_app_bundle.py", ...(offline ? ["release/offline/win-unpacked", "build/offline-runtime"] : [])])
run(process.execPath, ["scripts/verify_thesis_template_resource.mjs", offline ? "release/offline/win-unpacked/resources/app.asar" : "release/win-unpacked/resources/app.asar"])
