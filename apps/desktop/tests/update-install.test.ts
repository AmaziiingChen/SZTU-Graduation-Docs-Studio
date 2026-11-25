import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  buildUpdateInstallScript,
  installDirectoryForExecutable,
  powerShellLiteral,
  readUpdateInstallResult,
  removeUpdateInstallResult,
  updateInstallPaths,
  writeUpdateInstallScript,
  type UpdateInstallPlan,
} from "../electron/update-install"

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sztu-update-install-"))
  temporaryDirectories.push(directory)
  return directory
}

function plan(overrides: Partial<UpdateInstallPlan> = {}): UpdateInstallPlan {
  return {
    appProcessId: 4321,
    executablePath: "C:\\Program Files\\SZTU 文档工作台\\SZTU 文档工作台.exe",
    installDirectory: "C:\\Program Files\\SZTU 文档工作台",
    installerPath: "C:\\Users\\Zhang\\AppData\\Roaming\\SZTU\\updates\\sztu-docs-0.2.0-win32-x64.exe",
    resultPath: "C:\\Users\\Zhang\\AppData\\Roaming\\SZTU\\updates\\install-result.json",
    version: "0.2.0",
    ...overrides,
  }
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises")
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("update install script", () => {
  it("derives the install directory from the running executable", () => {
    expect(installDirectoryForExecutable("C:\\Program Files\\SZTU 文档工作台\\app.exe")).toBe("C:\\Program Files\\SZTU 文档工作台")
  })

  it("keeps update files under the user data directory", () => {
    const paths = updateInstallPaths("C:\\Users\\Zhang\\AppData\\Roaming\\SZTU 文档工作台")
    expect(paths.directory).toBe("C:\\Users\\Zhang\\AppData\\Roaming\\SZTU 文档工作台\\updates")
    expect(paths.resultPath.endsWith("install-result.json")).toBe(true)
    expect(paths.scriptPath.endsWith("install-update.ps1")).toBe(true)
  })

  it("waits for the app to exit, installs silently to the same directory, and restarts", () => {
    const script = buildUpdateInstallScript(plan())

    expect(script).toContain("$appProcessId = 4321")
    expect(script).toContain("$installer = 'C:\\Users\\Zhang\\AppData\\Roaming\\SZTU\\updates\\sztu-docs-0.2.0-win32-x64.exe'")
    expect(script).toContain("$installDirectory = 'C:\\Program Files\\SZTU 文档工作台'")
    expect(script).toContain("while ((Get-Process -Id $appProcessId -ErrorAction SilentlyContinue)")
    expect(script).toContain("Get-Date).AddSeconds(120)")
    // NSIS 不接受带引号的 /D=，即使路径里有空格。
    expect(script).toContain("$arguments = @('/S', ('/D=' + $installDirectory))")
    expect(script).not.toContain('/D="')
    expect(script).toContain("Start-Process -FilePath $installer -ArgumentList $arguments -Wait -PassThru")
    expect(script).toContain("Set-Content -Path $resultPath -Value $payload -Encoding UTF8")
    expect(script).toContain("Start-Process -FilePath $executable -ArgumentList '--updated'")
    expect(script).toContain("Start-Process -FilePath $executable -ArgumentList '--update-failed'")
    expect(script).toContain("$code = 3")
    expect(script.startsWith("# 由 SZTU 文档工作台生成")).toBe(true)
    expect(script.endsWith("\r\n")).toBe(true)
  })

  it("doubles single quotes instead of breaking the script", () => {
    const script = buildUpdateInstallScript(plan({ installDirectory: "C:\\Users\\O'Brien\\SZTU 文档工作台" }))
    expect(script).toContain("$installDirectory = 'C:\\Users\\O''Brien\\SZTU 文档工作台'")
  })

  it("rejects values that cannot be embedded in a single-quoted literal", () => {
    expect(() => powerShellLiteral("", "安装目录")).toThrow(/安装目录/)
    expect(() => powerShellLiteral("C:\\bad\npath", "安装目录")).toThrow(/安装目录/)
    expect(() => powerShellLiteral("C:\\bad\0path", "安装目录")).toThrow(/安装目录/)
  })

  it("rejects invalid process ids and version labels", () => {
    expect(() => buildUpdateInstallScript(plan({ appProcessId: 0 }))).toThrow(/进程号/)
    expect(() => buildUpdateInstallScript(plan({ appProcessId: 1.5 }))).toThrow(/进程号/)
    expect(() => buildUpdateInstallScript(plan({ version: "0.2 beta" }))).toThrow(/版本号/)
    expect(() => buildUpdateInstallScript(plan({ version: "v'.2" }))).toThrow(/版本号/)
  })

  it("writes the script as UTF-8 with a byte order mark", async () => {
    const directory = await temporaryDirectory()
    const scriptPath = path.join(directory, "updates", "install-update.ps1")
    await writeUpdateInstallScript(scriptPath, "# test\r\n")
    const bytes = await readFile(scriptPath)
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(bytes.subarray(3).toString("utf8")).toBe("# test\r\n")
  })

  it("reads installer results written with a BOM and rejects malformed ones", async () => {
    const directory = await temporaryDirectory()
    const resultPath = path.join(directory, "install-result.json")
    await writeFile(resultPath, "\uFEFF" + JSON.stringify({ exit_code: 0, version: "0.2.0", finished_at: "2026-11-25T12:00:00.0000000Z" }), "utf8")
    await expect(readUpdateInstallResult(resultPath)).resolves.toEqual({
      exitCode: 0,
      finishedAt: "2026-11-25T12:00:00.0000000Z",
      version: "0.2.0",
    })

    await writeFile(resultPath, "{not json", "utf8")
    await expect(readUpdateInstallResult(resultPath)).resolves.toBeNull()

    await writeFile(resultPath, JSON.stringify({ exit_code: "0", version: "0.2.0", finished_at: "2026-11-25T12:00:00Z" }), "utf8")
    await expect(readUpdateInstallResult(resultPath)).resolves.toBeNull()

    await writeFile(resultPath, JSON.stringify({ exit_code: 1, version: "0.2.0", finished_at: "not a date" }), "utf8")
    await expect(readUpdateInstallResult(resultPath)).resolves.toBeNull()

    await expect(readUpdateInstallResult(path.join(directory, "missing.json"))).resolves.toBeNull()
  })

  it("removes a stale result file without failing when it is already gone", async () => {
    const directory = await temporaryDirectory()
    const resultPath = path.join(directory, "install-result.json")
    await writeUpdateInstallScript(resultPath, "")
    await removeUpdateInstallResult(resultPath)
    await expect(readUpdateInstallResult(resultPath)).resolves.toBeNull()
    await expect(removeUpdateInstallResult(resultPath)).resolves.toBeUndefined()
  })
})
