import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TelemetryService } from "../electron/telemetry"

const hook = vi.hoisted(() => ({ rename: undefined as undefined | ((from: string, to: string) => Promise<void>) }))
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  const rename = async (from: string, to: string) => { await hook.rename?.(from, to); return actual.rename(from, to) }
  return { ...actual, rename, default: { ...actual, rename } }
})
const directories: string[] = []
afterEach(async () => { hook.rename = undefined; await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

async function fixture(endpoint?: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sztu-telemetry-regression-")); directories.push(directory)
  const fetchImpl = vi.fn(async () => ({ ok: true, status: 202 }))
  const options = { userDataPath: directory, appVersion: "0.1.5", platform: "darwin" as const, arch: "arm64", packaged: false, endpoint, fetchImpl }
  const service = new TelemetryService(options)
  await service.initialize(); await service.acceptNotice()
  return { directory, options, service, fetchImpl, queuePath: path.join(directory, "telemetry", "queue.json") }
}

describe("telemetry disk sequence with real temporary files", () => {
  it("prevents a delayed older rename from replacing a newer event snapshot and retains both after restart", async () => {
    const f = await fixture()
    let arrived!: () => void, release!: () => void, count = 0
    const reached = new Promise<void>((resolve) => { arrived = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    hook.rename = async (_from, to) => { if (to === f.queuePath && ++count === 1) { arrived(); await gate } }
    const first = f.service.recordUsage({ name: "view_opened", view: "profile" })
    await reached
    const second = f.service.recordUsage({ name: "view_opened", view: "inspection" })
    await Promise.resolve(); await Promise.resolve()
    expect(count).toBe(1)
    release(); await Promise.all([first, second])
    const persisted = JSON.parse(await readFile(f.queuePath, "utf8"))
    expect(persisted.map((event: { attributes: { view: string } }) => event.attributes.view)).toEqual(["profile", "inspection"])
    const restarted = new TelemetryService(f.options)
    await restarted.initialize(); await restarted.recordUpdate("up_to_date")
    expect(JSON.parse(await readFile(f.queuePath, "utf8"))).toHaveLength(3)
    expect(f.fetchImpl).not.toHaveBeenCalled()
  })

  it("preserves an event arriving during a successful flush and leaves it on disk", async () => {
    const f = await fixture("https://example.invalid/events")
    let respond!: (value: { ok: boolean; status: number }) => void
    f.fetchImpl.mockImplementationOnce(() => new Promise((resolve) => { respond = resolve }))
    await f.service.recordUsage({ name: "view_opened", view: "profile" })
    const flush = f.service.flush()
    await f.service.recordUsage({ name: "view_opened", view: "inspection" })
    respond({ ok: true, status: 202 }); expect(await flush).toBe(true)
    const persisted = JSON.parse(await readFile(f.queuePath, "utf8"))
    expect(persisted.map((event: { attributes: { view: string } }) => event.attributes.view)).toEqual(["inspection"])
    expect(f.fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("reports a failed disk write without poisoning later writes, and stop waits for queued persistence", async () => {
    const f = await fixture(); let failed = false
    hook.rename = async (_from, to) => { if (to === f.queuePath && !failed) { failed = true; throw new Error("synthetic rename failure") } }
    await expect(f.service.recordUsage({ name: "view_opened", view: "profile" })).rejects.toThrow("synthetic")
    hook.rename = undefined
    const second = f.service.recordUsage({ name: "view_opened", view: "inspection" })
    await f.service.stop(); await second
    expect(JSON.parse(await readFile(f.queuePath, "utf8"))).toHaveLength(2)
    expect(f.fetchImpl).not.toHaveBeenCalled()
  })
})
