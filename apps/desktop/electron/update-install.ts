/**
 * 自动安装更新：应用退出后由 PowerShell 静默运行安装包，再重新启动应用。
 *
 * 这个模块刻意不依赖 electron，方便在 jsdom 环境下单测脚本生成与结果解析。
 */
import { spawn } from "node:child_process"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

export type UpdateInstallPlan = {
  /** 当前应用进程号；安装脚本会等它退出后再运行安装包。 */
  appProcessId: number
  executablePath: string
  installDirectory: string
  installerPath: string
  resultPath: string
  version: string
}

export type UpdateInstallResult = {
  exitCode: number
  finishedAt: string
  version: string
}

export type UpdateInstallPaths = {
  directory: string
  resultPath: string
  scriptPath: string
}

/** 等应用退出的最长时间；超时后脚本不再安装，只记录结果。 */
const WAIT_FOR_EXIT_SECONDS = 120
/** 约定：3 表示应用没有在限定时间内退出，安装没有开始。 */
const EXIT_CODE_APP_STILL_RUNNING = 3
const MAX_EXIT_CODE = 2_147_483_647

export function updateInstallPaths(userDataPath: string): UpdateInstallPaths {
  // These paths are only consumed by the Windows installer flow. Using win32
  // semantics keeps behavior identical on Windows and makes the helpers
  // testable on macOS/Linux CI runners.
  const directory = path.win32.join(userDataPath, "updates")
  return {
    directory,
    resultPath: path.win32.join(directory, "install-result.json"),
    scriptPath: path.win32.join(directory, "install-update.ps1"),
  }
}

export function installDirectoryForExecutable(executablePath: string): string {
  return path.win32.dirname(executablePath)
}

/**
 * 把值写成 PowerShell 单引号字面量。
 * NSIS 的 `/D=` 参数不接受引号，因此路径本身不做引号包裹，只做单引号转义。
 */
export function powerShellLiteral(value: string, label: string): string {
  if (value.length === 0 || /[\r\n\0]/.test(value)) {
    throw new Error(`${label}包含无法写入安装脚本的字符。`)
  }
  return `'${value.replaceAll("'", "''")}'`
}

export function buildUpdateInstallScript(plan: UpdateInstallPlan): string {
  if (!Number.isInteger(plan.appProcessId) || plan.appProcessId <= 0) {
    throw new Error("安装脚本需要有效的应用进程号。")
  }
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/.test(plan.version)) {
    throw new Error("更新版本号格式不正确。")
  }
  const installer = powerShellLiteral(plan.installerPath, "安装包路径")
  const installDirectory = powerShellLiteral(plan.installDirectory, "安装目录")
  const executable = powerShellLiteral(plan.executablePath, "应用路径")
  const resultPath = powerShellLiteral(plan.resultPath, "安装结果路径")
  const version = powerShellLiteral(plan.version, "版本号")
  const lines = [
    "# 由 SZTU 文档工作台生成：等待应用退出，静默安装更新，然后重新启动。",
    "$ErrorActionPreference = 'Stop'",
    `$appProcessId = ${plan.appProcessId}`,
    `$installer = ${installer}`,
    `$installDirectory = ${installDirectory}`,
    `$executable = ${executable}`,
    `$resultPath = ${resultPath}`,
    `$version = ${version}`,
    `$deadline = (Get-Date).AddSeconds(${WAIT_FOR_EXIT_SECONDS})`,
    "while ((Get-Process -Id $appProcessId -ErrorAction SilentlyContinue) -and ((Get-Date) -lt $deadline)) {",
    "  Start-Sleep -Milliseconds 250",
    "}",
    `$code = ${EXIT_CODE_APP_STILL_RUNNING}`,
    "if (-not (Get-Process -Id $appProcessId -ErrorAction SilentlyContinue)) {",
    "  $code = 1",
    "  try {",
    "    # NSIS 要求 /D= 是最后一个参数，且路径不能加引号，即使路径里有空格。",
    "    $arguments = @('/S', ('/D=' + $installDirectory))",
    "    $installerProcess = Start-Process -FilePath $installer -ArgumentList $arguments -Wait -PassThru",
    "    $code = [int]$installerProcess.ExitCode",
    "  } catch {",
    "    $code = 1",
    "  }",
    "}",
    "$payload = [ordered]@{ exit_code = $code; version = $version; finished_at = (Get-Date).ToString('o') } | ConvertTo-Json -Compress",
    "Set-Content -Path $resultPath -Value $payload -Encoding UTF8",
    `if ($code -ne ${EXIT_CODE_APP_STILL_RUNNING}) {`,
    "  try {",
    "    if ($code -eq 0) { Start-Process -FilePath $executable -ArgumentList '--updated' }",
    "    else { Start-Process -FilePath $executable -ArgumentList '--update-failed' }",
    "  } catch { }",
    "}",
    "",
  ]
  return lines.join("\r\n")
}

/** 脚本用 UTF-8 BOM 落盘：Windows PowerShell 5.1 只有见到 BOM 才会按 UTF-8 读取中文路径。 */
export async function writeUpdateInstallScript(scriptPath: string, script: string): Promise<void> {
  await mkdir(path.dirname(scriptPath), { recursive: true, mode: 0o700 })
  await writeFile(scriptPath, `\uFEFF${script}`, "utf8")
}

export function startUpdateInstallScript(scriptPath: string): void {
  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-WindowStyle",
      "Hidden",
      "-File",
      scriptPath,
    ],
    { detached: true, stdio: "ignore", windowsHide: true },
  )
  child.unref()
}

export async function readUpdateInstallResult(resultPath: string): Promise<UpdateInstallResult | null> {
  let text: string
  try {
    text = await readFile(resultPath, "utf8")
  } catch {
    return null
  }
  let payload: unknown
  try {
    payload = JSON.parse(text.replace(/^\uFEFF/, ""))
  } catch {
    return null
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  const record = payload as Record<string, unknown>
  const exitCode = record.exit_code
  const version = record.version
  const finishedAt = record.finished_at
  if (
    typeof exitCode !== "number" ||
    !Number.isInteger(exitCode) ||
    exitCode < 0 ||
    exitCode > MAX_EXIT_CODE
  ) {
    return null
  }
  if (typeof version !== "string" || version.length === 0 || version.length > 64) return null
  if (typeof finishedAt !== "string" || Number.isNaN(Date.parse(finishedAt))) return null
  return { exitCode, finishedAt, version }
}

export async function removeUpdateInstallResult(resultPath: string): Promise<void> {
  await rm(resultPath, { force: true }).catch(() => undefined)
}
