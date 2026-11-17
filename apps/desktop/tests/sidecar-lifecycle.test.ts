import { EventEmitter } from "node:events"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SidecarClient } from "../electron/sidecar-client"

const mock = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock("node:child_process", () => ({ spawn: mock.spawn, default: { spawn: mock.spawn } }))
const offline = vi.hoisted(() => ({ offlineRuntimePaths: vi.fn((): string[] => []) }))
vi.mock("../electron/offline-runtime", () => offline)

class FakeChild extends EventEmitter {
  stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
  stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
  stdin = { write: vi.fn((_message: string, _encoding: string, cb: (error: null) => void) => cb(null)) }
  killed = false
  exitCode: number | null = null
  signalCode: string | null = null
  kill = vi.fn((_signal?: string) => { this.killed = true; return true })
  finish() { this.exitCode = 0; this.emit("exit", 0, null); this.emit("close", 0, null) }
  id() { return JSON.parse(this.stdin.write.mock.calls.at(-1)![0]).id as string }
  success(result: unknown) { this.stdout.emit("data", Buffer.from(`${JSON.stringify({ protocol: "1.0", id: this.id(), ok: true, result })}\n`)) }
  cancelled() { this.stdout.emit("data", Buffer.from(`${JSON.stringify({ protocol: "1.0", id: this.id(), ok: false, error: { code: "EXPORT_CANCELLED", message: "cancelled" } })}\n`)) }
}

beforeEach(() => { vi.useFakeTimers(); mock.spawn.mockReset() })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); offline.offlineRuntimePaths.mockImplementation(() => []) })

describe("sidecar deadlines and confirmed process termination", () => {
  it("names an unusable offline engine instead of failing as an unknown error", async () => {
    offline.offlineRuntimePaths.mockImplementation(() => {
      throw new Error("Offline runtime is installed outside an ASCII path; rerun the installer")
    })
    const client = new SidecarClient("/backend", mkdtempSync(path.join(tmpdir(), "sztu-engine-")), "python", { retryRequests: false })

    await expect(client.request("document.check", {}, 100)).rejects.toMatchObject({
      code: "RENDER_ENGINE_UNAVAILABLE",
      details: { reason: "Offline runtime is installed outside an ASCII path; rerun the installer" },
    })
    expect(mock.spawn).not.toHaveBeenCalled()
  })

  it("retains the raw malformed protocol line for an isolated request", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "sztu-protocol-fault-"))
    try {
      const child = new FakeChild()
      mock.spawn.mockReturnValue(child)
      const client = new SidecarClient("/backend", root, "python", { retryRequests: false })
      const request = client.request("document.check", {}, 100, { onDiagnostic: vi.fn() })
      const malformed = Buffer.from([0xff, 0xfe, 10])
      child.stdout.emit("data", malformed)
      await expect(request).rejects.toMatchObject({ code: "INVALID_SIDECAR_JSON", diagnosticCaseId: child.id() })
      expect(readFileSync(path.join(root, "diagnostics", "full", child.id(), "engine-protocol-fragment.bin"))).toEqual(malformed)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("does not reject a queued draft until the control worker has exited", async () => {
    const child = new FakeChild(); mock.spawn.mockReturnValue(child)
    const client = new SidecarClient("/backend", "/data", "python", { role: "control", retryRequests: false })
    const settled = vi.fn()
    const request = client.request("workspace.saveDraft", {}, 100).catch((error: unknown) => { settled(error); return error })
    await vi.advanceTimersByTimeAsync(100)
    expect(child.kill).toHaveBeenCalled()
    expect(settled).not.toHaveBeenCalled()
    expect(client.running).toBe(false)
    child.finish()
    expect(await request).toMatchObject({ code: "REQUEST_TIMEOUT" })
    expect(settled).toHaveBeenCalledTimes(1)
    expect(mock.spawn).toHaveBeenCalledTimes(1)
  })

  it("retains a timed-out render until confirmed cancellation", async () => {
    const child = new FakeChild(); mock.spawn.mockReturnValue(child)
    const client = new SidecarClient("/backend", "/data", "python", { role: "render", retryRequests: false })
    const cancel = vi.fn(async () => undefined), settled = vi.fn()
    const request = client.request("export.run", {}, 100, { onDeadline: cancel }).catch((error: unknown) => { settled(error); return error })
    await vi.advanceTimersByTimeAsync(100)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(settled).not.toHaveBeenCalled()
    expect(child.kill).not.toHaveBeenCalled()
    child.cancelled()
    expect(await request).toMatchObject({ code: "REQUEST_TIMEOUT", details: { cancellation_confirmed: true } })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(child.kill).not.toHaveBeenCalled()
    client.dispose()
  })

  it("reports a real completion that races the deadline cancellation", async () => {
    const child = new FakeChild(); mock.spawn.mockReturnValue(child)
    const client = new SidecarClient("/backend", "/data", "python", { role: "render", retryRequests: false })
    const request = client.request("export.run", {}, 100, { onDeadline: async () => undefined })
    await vi.advanceTimersByTimeAsync(100)
    child.success({ status: "completed", export_id: "actual" })
    expect(await request).toEqual({ status: "completed", export_id: "actual" })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(child.kill).not.toHaveBeenCalled()
    client.dispose()
  })

  it("uses an unknown outcome only after a silent render worker has exited", async () => {
    const child = new FakeChild(); mock.spawn.mockReturnValue(child)
    const client = new SidecarClient("/backend", "/data", "python", { role: "render", retryRequests: false })
    const settled = vi.fn()
    const request = client.request("preview.generate", {}, 100, { onDeadline: async () => undefined, cancellationGraceMs: 50 })
      .catch((error: unknown) => { settled(error); return error })
    await vi.advanceTimersByTimeAsync(150)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(child.kill).toHaveBeenLastCalledWith("SIGKILL")
    child.finish()
    expect(await request).toMatchObject({ code: "REQUEST_OUTCOME_UNKNOWN" })
  })

  it("recovers interrupted exports only on the first control generation", async () => {
    const first = new FakeChild(), second = new FakeChild(), render = new FakeChild()
    mock.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second).mockReturnValueOnce(render)
    const control = new SidecarClient("/backend", "/data", "python", { role: "control", retryRequests: false })
    const one = control.request("system.ping"); first.success("ready"); await one
    expect(mock.spawn.mock.calls[0][2].env).toMatchObject({ SZTU_DOCS_SIDECAR_ROLE: "control", SZTU_DOCS_RECOVER_INTERRUPTED: "1" })
    first.finish()
    const two = control.request("system.ping"); second.success("ready"); await two
    expect(mock.spawn.mock.calls[1][2].env).toMatchObject({ SZTU_DOCS_RECOVER_INTERRUPTED: "0" })
    const worker = new SidecarClient("/backend", "/data", "python", { role: "render", retryRequests: false })
    const three = worker.request("workspace.open", { mode: "persistent" }); render.success({ mode: "persistent", render_ready: true }); await three
    expect(mock.spawn.mock.calls[2][2].env).toMatchObject({ SZTU_DOCS_SIDECAR_ROLE: "render", SZTU_DOCS_RECOVER_INTERRUPTED: "0" })
    control.dispose(); worker.dispose()
  })

  it("blocks new requests during shutdown and ignores errors from an old generation", async () => {
    const first = new FakeChild(), second = new FakeChild()
    mock.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second)
    const client = new SidecarClient("/backend", "/data", "python", { retryRequests: false })
    const one = client.request("system.ping"); first.success("ready"); await one
    const stopped = client.stop()
    await expect(client.request("workspace.saveDraft", {})).rejects.toMatchObject({ code: "SIDECAR_STOPPING" })
    expect(mock.spawn).toHaveBeenCalledTimes(1)
    first.finish(); await stopped
    const two = client.request("system.ping")
    first.emit("error", new Error("late old process failure"))
    expect(second.kill).not.toHaveBeenCalled()
    second.success("new-ready")
    expect(await two).toBe("new-ready")
    client.dispose()
  })
})
