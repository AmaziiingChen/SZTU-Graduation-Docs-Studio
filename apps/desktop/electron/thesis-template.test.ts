import { createHash } from "node:crypto"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { checkThesisTemplateResource, downloadThesisTemplate } from "./thesis-template.js"

const directories: string[] = []
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "thesis-download-"))
  directories.push(directory)
  const bytes = Buffer.from("504b0304aabbccdd", "hex")
  await writeFile(path.join(directory, "sztu-thesis-2026.zip"), bytes)
  await writeFile(path.join(directory, "sztu-thesis-2026.json"), JSON.stringify({
    filename: "sztu-thesis-2026.zip", version: "2026.1.0", sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }))
  return { directory, bytes }
}
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })

describe("bundled thesis download", () => {
  it("checks the actual source package without requiring a thesis rendering engine", async () => {
    const resource = path.resolve(import.meta.dirname, "../resources/thesis-template")
    await expect(checkThesisTemplateResource(resource)).resolves.toMatchObject({id: "thesis_template", status: "pass", required: false})
    const {directory} = await fixture()
    await writeFile(path.join(directory, "sztu-thesis-2026.zip"), "corrupt archive")
    await expect(checkThesisTemplateResource(directory)).resolves.toMatchObject({status: "warn"})
  })
  it("saves the verified bytes and replaces only the user-selected target", async () => {
    const { directory, bytes } = await fixture()
    const target = path.join(directory, "用户选择.zip")
    await writeFile(target, "previous")
    const choose = vi.fn().mockResolvedValue(target)
    await expect(downloadThesisTemplate(directory, choose)).resolves.toEqual({ saved: true })
    expect(choose).toHaveBeenCalledWith("sztu-thesis-2026.zip")
    expect(await readFile(target)).toEqual(bytes)
    expect((await readdir(directory)).some(name => name.endsWith(".part"))).toBe(false)
  })
  it("does not write anything on cancel", async () => {
    const { directory } = await fixture()
    const before = await readdir(directory)
    await expect(downloadThesisTemplate(directory, async () => null)).resolves.toEqual({ saved: false })
    expect(await readdir(directory)).toEqual(before)
  })
  it("rejects altered bytes before showing the save dialog", async () => {
    const { directory } = await fixture()
    await writeFile(path.join(directory, "sztu-thesis-2026.zip"), Buffer.from("504b0304ffeeddcc", "hex"))
    const choose = vi.fn()
    await expect(downloadThesisTemplate(directory, choose)).rejects.toThrow("缺失或损坏")
    expect(choose).not.toHaveBeenCalled()
  })
  it("reports a failed save without claiming success or leaving partial files", async () => {
    const { directory } = await fixture()
    await expect(downloadThesisTemplate(directory, async () => path.join(directory, "missing", "thesis.zip"))).rejects.toThrow("模板未保存")
    expect((await readdir(directory)).some(name => name.endsWith(".part"))).toBe(false)
  })
  it("validates and saves the actual application resource", async () => {
    const { directory } = await fixture()
    const target = path.join(directory, "real.zip")
    const resource = path.resolve(import.meta.dirname, "../resources/thesis-template")
    await expect(downloadThesisTemplate(resource, async () => target)).resolves.toEqual({ saved: true })
    expect(await readFile(target)).toEqual(await readFile(path.join(resource, "sztu-thesis-2026.zip")))
  })
})
