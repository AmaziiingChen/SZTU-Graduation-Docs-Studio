import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, it } from "vitest"
import { documentFontDirectories, registerWindowsDocumentFonts } from "../electron/document-fonts"

it("uses explicit, shipped and development-private fonts without changing system paths", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "sztu-font-roots-"))
  try {
    const backend = path.join(root, "backend")
    expect(documentFontDirectories(backend, "")).toBeUndefined()
    const shipped = path.join(root, "document-fonts")
    const local = path.join(root, "local-fonts")
    mkdirSync(shipped); mkdirSync(local)
    expect(documentFontDirectories(backend, "")).toBe([shipped, local].join(path.delimiter))
    expect(documentFontDirectories(backend, shipped)).toBe([shipped, local].join(path.delimiter))
  } finally { rmSync(root, {recursive: true, force: true}) }
})

it("registers bundled fonts for the current user without admin rights", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "sztu-font-register-"))
  try {
    const backend = path.join(root, "backend")
    const shipped = path.join(root, "document-fonts")
    const local = path.join(root, "local-fonts")
    const localAppData = path.join(root, "LocalAppData")
    mkdirSync(backend); mkdirSync(shipped); mkdirSync(local)
    writeFileSync(path.join(shipped, "simkai.ttf"), "kai")
    writeFileSync(path.join(local, "STZhongsong.ttf"), "zhong")
    const calls: { copy: string; args?: string[] }[] = []
    const runReg = async (args: string[]) => { calls.push({ copy: "", args }) }

    const first = await registerWindowsDocumentFonts(backend, {
      platform: "win32",
      localAppData,
      copyFile: (source, destination) => { calls.push({ copy: destination }); copyFileSync(source, destination) },
      runReg,
    })
    const userFonts = path.join(localAppData, "Microsoft", "Windows", "Fonts")
    expect(first.directory).toBe(userFonts)
    expect(first.failed).toEqual([])
    expect(first.registered.sort()).toEqual(["STZhongsong.ttf", "simkai.ttf"])
    expect(readFileSync(path.join(userFonts, "simkai.ttf"), "utf8")).toBe("kai")
    expect(calls.filter((call) => call.copy)).toHaveLength(2)
    const registration = calls.find((call) => call.args)
    expect(registration?.args).toEqual([
      "add",
      String.raw`HKCU\Software\Microsoft\Windows NT\CurrentVersion\Fonts`,
      "/v",
      "simkai (TrueType)",
      "/t",
      "REG_SZ",
      "/d",
      path.join(userFonts, "simkai.ttf"),
      "/f",
    ])

    const copiesBefore = calls.filter((call) => call.copy).length
    const second = await registerWindowsDocumentFonts(backend, {
      platform: "win32",
      localAppData,
      copyFile: (source, destination) => { calls.push({ copy: destination }); copyFileSync(source, destination) },
      runReg,
    })
    expect(second.failed).toEqual([])
    expect(calls.filter((call) => call.copy)).toHaveLength(copiesBefore)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

it("does nothing outside Windows", async () => {
  const result = await registerWindowsDocumentFonts(path.join(os.tmpdir(), "missing-backend"), {
    platform: "darwin",
    runReg: async () => { throw new Error("must not run") },
  })
  expect(result).toEqual({ directory: undefined, registered: [], failed: [] })
})
