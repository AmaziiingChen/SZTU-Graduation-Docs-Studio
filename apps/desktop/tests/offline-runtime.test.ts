import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { afterEach, expect, it } from "vitest"
import { offlineRuntimePaths } from "../electron/offline-runtime"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "sztu offline test-"))
  roots.push(root)
  return {root, backend: path.join(root, "backend"), runtime: path.join(root, "offline-runtime")}
}
it("keeps ordinary builds on the system toolchain", () => {
  expect(offlineRuntimePaths(fixture().backend, "win32", "x64")).toEqual([])
})
it("finds a moved Windows runtime including paths with spaces", () => {
  const {backend, runtime} = fixture()
  const bins = [path.join(runtime, "texlive/bin/windows"), path.join(runtime, "poppler/Library/bin")]
  for (const bin of bins) mkdirSync(bin, {recursive:true})
  writeFileSync(path.join(bins[0], "xelatex.exe"), "synthetic marker")
  writeFileSync(path.join(bins[1], "pdftoppm.exe"), "synthetic marker")
  writeFileSync(path.join(runtime, "runtime-manifest.json"), JSON.stringify({schema_version:"1.0",platform:"win32",architecture:"x64"}))
  expect(offlineRuntimePaths(backend, "win32", "x64")).toEqual(bins)
  expect(offlineRuntimePaths(backend, "darwin", "arm64")).toEqual([])
})
it("rejects an incomplete or mismatched bundled runtime", () => {
  const {backend, runtime} = fixture()
  mkdirSync(runtime)
  writeFileSync(path.join(runtime, "runtime-manifest.json"), JSON.stringify({schema_version:"1.0",platform:"win32",architecture:"arm64"}))
  expect(() => offlineRuntimePaths(backend, "win32", "x64")).toThrow("target")
  writeFileSync(path.join(runtime, "runtime-manifest.json"), JSON.stringify({schema_version:"1.0",platform:"win32",architecture:"x64"}))
  expect(() => offlineRuntimePaths(backend, "win32", "x64")).toThrow("incomplete")
})

it.each(["1.0", "2.0"])("resolves layout %s and rejects interrupted installs", (schemaVersion) => {
  const { root, backend } = fixture()
  const id = "a".repeat(64)
  const runtime = schemaVersion === "2.0" ? path.join(root, "SZTU-Docs/r", id.slice(0, 16)) : path.join(root, "SZTU-Docs-Studio/runtimes", id)
  const bins = [path.join(runtime, "texlive/bin/windows"), path.join(runtime, "poppler/Library/bin")]
  for (const bin of bins) mkdirSync(bin, { recursive: true })
  writeFileSync(path.join(bins[0], "xelatex.exe"), "fixture")
  writeFileSync(path.join(bins[1], "pdftoppm.exe"), "fixture")
  const manifest = JSON.stringify({ schema_version: "1.0", platform: "win32", architecture: "x64" })
  writeFileSync(path.join(runtime, "runtime-manifest.json"), manifest)
  writeFileSync(path.join(root, "offline-runtime-location.json"), JSON.stringify({ schema_version: schemaVersion, runtime_id: id, manifest_sha256: createHash("sha256").update(manifest).digest("hex") }))
  expect(() => offlineRuntimePaths(backend, "win32", "x64", root)).toThrow("incomplete")
  writeFileSync(path.join(runtime, "complete.txt"), "b".repeat(64))
  expect(() => offlineRuntimePaths(backend, "win32", "x64", root)).toThrow("incomplete")
  writeFileSync(path.join(runtime, "complete.txt"), id)
  expect(offlineRuntimePaths(backend, "win32", "x64", root)).toEqual(bins)
  writeFileSync(path.join(runtime, "runtime-manifest.json"), manifest + " ")
  expect(() => offlineRuntimePaths(backend, "win32", "x64", root)).toThrow("integrity")
  writeFileSync(path.join(root, "offline-runtime-location.json"), JSON.stringify({ schema_version: "1.0", runtime_id: "../escape", manifest_sha256: "b".repeat(64) }))
  expect(() => offlineRuntimePaths(backend, "win32", "x64", root)).toThrow("invalid")
})
