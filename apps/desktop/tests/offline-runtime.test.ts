import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
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
