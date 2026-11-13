import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import { FullDiagnostics } from "../electron/full-diagnostics.js"

afterEach(() => vi.unstubAllGlobals())

it("previews and saves the exact selected case without submitting it", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "sztu-case-test-"))
  try {
    const bytes = Buffer.from([80, 75, 3, 4, 255, 254])
    const id = "435565ec-38c5-4917-94e6-0e7bf1fa7763"
    const directory = path.join(workspace, "diagnostics", "full", id)
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, "case.zip"), bytes)
    await writeFile(path.join(directory, "manifest.json"), JSON.stringify({
      reportId: id, operation: "preview.generate", createdAt: Date.now() / 1000,
      files: [], missing: [], sizeBytes: bytes.length,
    }))
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const service = new FullDiagnostics(workspace, "https://example.invalid/api/v1/reports")
    expect((await service.get(id))?.reportId).toBe(id)
    expect(await service.get("d2637e70-d719-4229-8e7e-f57d16434233")).toBeNull()
    await service.save(id, path.join(workspace, "saved.zip"))
    expect(await readFile(path.join(workspace, "saved.zip"))).toEqual(bytes)
    expect(fetch).not.toHaveBeenCalled()

    fetch.mockResolvedValueOnce(Response.json({ ok: true, report_id: id, sha256: "wrong", retention_days: 30 }, { status: 202 }))
    await expect(service.send(id)).rejects.toThrow("未确认入库")
    fetch.mockResolvedValueOnce(Response.json({
      ok: true, report_id: id, sha256: createHash("sha256").update(bytes).digest("hex"), retention_days: 30,
    }, { status: 202 }))
    await expect(service.send(id)).resolves.toEqual({ reportId: id, retentionDays: 30 })
    const [url, request] = fetch.mock.lastCall!
    expect(String(url)).toBe("https://example.invalid/api/v1/full-reports")
    expect(Buffer.from(request.body)).toEqual(bytes)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
