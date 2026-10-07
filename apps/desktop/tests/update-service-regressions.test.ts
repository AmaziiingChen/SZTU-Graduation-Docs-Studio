import { createHash, generateKeyPairSync, sign } from "node:crypto"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { canonicalJson, UpdateService, type UpdateManifestPayload } from "../electron/update-service"

const directories: string[] = []
afterEach(async () => { vi.useRealTimers(); await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sztu-update-regression-")); directories.push(directory)
  const keys = generateKeyPairSync("ed25519")
  const payload = (bytes?: Buffer): UpdateManifestPayload => ({
    schema_version: "2.0", channel: "stable", version: "0.2.0", published_at: "2026-10-03T00:00:00Z",
    artifacts: bytes ? [{ platform: "darwin", arch: "arm64", url: "https://example.invalid/fake.zip", size_bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }] : [],
    control: { update_policy: "recommended", minimum_supported_version: "0.1.0", service_status: "normal", help_url: null, announcement: { id: "fixture", title: "离线公告", body: "虚构测试内容", severity: "info", starts_at: "2026-10-01T00:00:00Z", ends_at: null, dismissible: true } },
  })
  const response = (value: UpdateManifestPayload) => Response.json({ payload: value, signature: sign(null, Buffer.from(canonicalJson(value)), keys.privateKey).toString("base64") })
  const options = { userDataPath: directory, currentVersion: "0.1.5", platform: "darwin" as const, arch: "arm64", manifestUrl: "https://example.invalid/manifest.json", publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(), now: () => new Date("2026-10-03T00:00:00Z") }
  return { directory, payload, response, options }
}

describe("offline signed updates and response bodies", () => {
  it("reports streamed byte progress and verifies before making the installer available", async () => {
    const f = await fixture(), bytes = Buffer.from("ABCDEF")
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value } })
    const service = new UpdateService({ ...f.options, fetchImpl: async (url) => url.endsWith("manifest.json") ? f.response(f.payload(bytes)) : new Response(stream) })
    const states: string[] = []
    service.onStatus((status) => states.push(status.state === "downloading" ? status.phase : status.state))
    await service.checkNow()
    const pending = service.downloadNow()
    expect(service.getStatus()).toMatchObject({ state: "downloading", downloadedBytes: 0, sizeBytes: 6, phase: "transferring" })
    controller.enqueue(bytes.subarray(0, 3))
    await vi.waitFor(() => expect(service.getStatus()).toMatchObject({ state: "downloading", downloadedBytes: 3, sizeBytes: 6 }))
    expect(service.revealDownloadedPath()).toBeNull()
    controller.enqueue(bytes.subarray(3))
    controller.close()
    expect((await pending).state).toBe("downloaded")
    expect(states.indexOf("verifying")).toBeLessThan(states.indexOf("downloaded"))
    expect(await readFile(service.revealDownloadedPath()!)).toEqual(bytes)
  })

  it.each([["win32", "x64"], ["darwin", "arm64"]] as const)("notifies %s/%s without downloading until requested", async (platform, arch) => {
    const f = await fixture(), bytes = Buffer.from("AAA"), value = f.payload(bytes), outcome = vi.fn()
    value.artifacts[0]!.platform = platform
    value.artifacts[0]!.arch = arch
    const fetchImpl = vi.fn(async (url: string) => url.endsWith("manifest.json") ? f.response(value) : new Response(bytes))
    const service = new UpdateService({ ...f.options, platform, arch, fetchImpl, onOutcome: outcome })
    expect(await service.checkNow()).toMatchObject({ state: "available", version: "0.2.0", sizeBytes: 3 })
    await service.checkNow()
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([f.options.manifestUrl, f.options.manifestUrl])
    expect(outcome.mock.calls.filter(([kind]) => kind === "available")).toHaveLength(1)
    expect(await service.downloadNow()).toMatchObject({ state: "downloaded", version: "0.2.0" })
    expect(await readFile(service.revealDownloadedPath()!)).toEqual(bytes)
  })

  it("keeps a hash failure retryable without revealing an unverified installer", async () => {
    const f = await fixture(), bytes = Buffer.from("AAA"); let corrupt = true
    const service = new UpdateService({ ...f.options, fetchImpl: async (url) => url.endsWith("manifest.json") ? f.response(f.payload(bytes)) : new Response(corrupt ? Buffer.from("BBB") : bytes) })
    await service.checkNow()
    expect(await service.downloadNow()).toMatchObject({ state: "available", downloadFailed: true })
    expect(service.revealDownloadedPath()).toBeNull()
    expect(await readdir(path.join(f.directory, "updates"))).toEqual([])
    corrupt = false
    expect((await service.downloadNow()).state).toBe("downloaded")
  })

  it("deduplicates download clicks and leaves an active download unchanged during polling", async () => {
    const f = await fixture(), bytes = Buffer.from("AAA")
    let complete!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { complete = resolve })
    const fetchImpl = vi.fn(async (url: string) => url.endsWith("manifest.json") ? f.response(f.payload(bytes)) : pending)
    const service = new UpdateService({ ...f.options, fetchImpl })
    await service.checkNow()
    const first = service.downloadNow()
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2))
    expect((await service.downloadNow()).state).toBe("downloading")
    expect((await service.checkNow()).state).toBe("downloading")
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    complete(new Response(bytes))
    expect((await first).state).toBe("downloaded")
  })

  it("accepts a newer announcement-only schema 2 manifest without failed telemetry or an installer", async () => {
    const f = await fixture(), outcome = vi.fn()
    const fetchImpl = vi.fn(async () => f.response(f.payload()))
    const service = new UpdateService({ ...f.options, fetchImpl, onOutcome: outcome })
    expect(await service.checkNow()).toMatchObject({ state: "up_to_date", control: { updatePolicy: "recommended", announcement: { id: "fixture" } } })
    expect(outcome).toHaveBeenCalledWith("up_to_date")
    expect(outcome).not.toHaveBeenCalledWith("failed")
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(service.revealDownloadedPath()).toBeNull()
  })

  it("retains the platform-mismatch failure for a manifest that actually includes installers", async () => {
    const f = await fixture(), value = f.payload(Buffer.from("AAA"))
    value.artifacts[0]!.arch = "x64"
    const service = new UpdateService({ ...f.options, fetchImpl: async () => f.response(value) })
    expect(await service.checkNow()).toMatchObject({ state: "error", code: "CHECK_FAILED" })
  })

  it("redownloads changed signed content at the same version and size, then verifies local cache bytes", async () => {
    const f = await fixture(); let bytes = Buffer.from("AAA"), downloads = 0
    const service = new UpdateService({ ...f.options, fetchImpl: async (url) => {
      if (url.endsWith("manifest.json")) return f.response(f.payload(bytes))
      downloads++; return new Response(bytes)
    } })
    expect((await service.checkNow()).state).toBe("available")
    expect(downloads).toBe(0)
    expect((await service.downloadNow()).state).toBe("downloaded")
    bytes = Buffer.from("BBB")
    expect((await service.checkNow()).state).toBe("available")
    expect(downloads).toBe(1)
    expect((await service.downloadNow()).state).toBe("downloaded")
    expect(downloads).toBe(2)
    expect((await readFile(service.revealDownloadedPath()!)).toString()).toBe("BBB")
    await writeFile(service.revealDownloadedPath()!, "CCC")
    expect((await service.checkNow()).state).toBe("available")
    expect(downloads).toBe(2)
    expect((await service.downloadNow()).state).toBe("downloaded")
    expect(downloads).toBe(3)
    expect((await readFile(service.revealDownloadedPath()!)).toString()).toBe("BBB")
    await service.checkNow()
    expect(downloads).toBe(3)
  })

  it("aborts a stalled manifest body, exits checking and permits a subsequent check", async () => {
    const f = await fixture(); let signal!: AbortSignal
    const cancelled = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ cancel: cancelled })
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => { signal = init!.signal as AbortSignal; return new Response(stream) })
    const service = new UpdateService({ ...f.options, fetchImpl })
    vi.useFakeTimers()
    const pending = service.checkNow()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await pending).toMatchObject({ state: "error", code: "CHECK_FAILED" })
    expect(signal.aborted).toBe(true)
    expect(cancelled).toHaveBeenCalled()
    fetchImpl.mockImplementation(async () => f.response(f.payload()))
    expect((await service.checkNow()).state).toBe("up_to_date")
  })

  it("aborts a stalled installer body and removes its partial file", async () => {
    const f = await fixture(), bytes = Buffer.from("AAA"), cancelled = vi.fn()
    let signal!: AbortSignal, began!: () => void
    const started = new Promise<void>((resolve) => { began = resolve })
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([65])) }, cancel: cancelled })
    const service = new UpdateService({ ...f.options, fetchImpl: async (url, init) => {
      if (url.endsWith("manifest.json")) return f.response(f.payload(bytes))
      signal = init!.signal as AbortSignal; began(); return new Response(stream)
    } })
    await service.checkNow()
    vi.useFakeTimers()
    const pending = service.downloadNow()
    await started
    await vi.waitFor(async () => {
      const [partial] = await readdir(path.join(f.directory, "updates"))
      expect(partial).toMatch(/\.tmp$/)
      expect((await readFile(path.join(f.directory, "updates", partial!))).toString()).toBe("A")
    })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await pending).toMatchObject({ state: "available", downloadFailed: true })
    expect(signal.aborted).toBe(true)
    vi.useRealTimers()
    await vi.waitFor(async () => {
      expect(cancelled).toHaveBeenCalled()
      expect(await readdir(path.join(f.directory, "updates"))).toEqual([])
    })
    expect(service.revealDownloadedPath()).toBeNull()
  })
})
