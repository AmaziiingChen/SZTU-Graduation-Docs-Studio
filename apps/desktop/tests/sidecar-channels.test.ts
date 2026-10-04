import { describe, expect, it, vi } from "vitest"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { SidecarChannels } from "../electron/sidecar-channels"
import type { SidecarClient } from "../electron/sidecar-client"

function fixture(dataRoot = "/data") {
  const control = { running: true, request: vi.fn(async () => ({ mode: "persistent" })), stop: vi.fn(async () => undefined) }
  const render = { running: true, request: vi.fn(async () => ({ mode: "persistent", render_ready: true })), stop: vi.fn(async () => undefined) }
  const channels = new SidecarChannels(control as unknown as SidecarClient, render as unknown as SidecarClient, dataRoot)
  return { control, render, channels }
}

describe("control and rendering process queues", () => {
  it("saves and reads history while rendering, but protects its document and templates", async () => {
    const { control, render, channels } = fixture()
    await channels.request("workspace.open", { mode: "persistent" })
    let complete!: (result: unknown) => void
    render.request.mockImplementationOnce(async () => ({ mode: "persistent", render_ready: true }))
      .mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }) as never)
    const preview = channels.request("preview.generate", { document_id: "document-a" })
    await Promise.resolve(); await Promise.resolve()
    await channels.request("workspace.saveDraft", { document_id: "document-a" })
    await channels.request("export.history", { document_id: "document-a" })
    expect(control.request).toHaveBeenCalledWith("workspace.saveDraft", { document_id: "document-a" }, undefined)
    expect(control.request).toHaveBeenCalledWith("export.history", { document_id: "document-a" }, undefined)
    for (const [method, params] of [
      ["workspace.purgeDocument", { document_id: "document-a" }],
      ["workspace.open", { mode: "temporary" }],
      ["template.install", {}],
      ["preview.generate", { document_id: "document-b" }],
    ] as const) await expect(channels.request(method, params)).rejects.toMatchObject({ code: "RENDER_BUSY" })
    await channels.request("workspace.purgeDocument", { document_id: "document-b" })
    complete({ done: true }); await preview
    await channels.request("workspace.open", { mode: "temporary" })
    await expect(channels.request("preview.generate", { document_id: "document-a" })).rejects.toMatchObject({ code: "PREVIEW_UNAVAILABLE" })
  })

  it("keeps preflight and export on the same render session", async () => {
    const { control, render, channels } = fixture()
    await channels.request("workspace.open", { mode: "persistent" })
    await channels.request("export.preflight", { document_id: "document-a" })
    await channels.request("export.run", { document_id: "document-a" })
    expect(render.request.mock.calls.filter(([method]) => method === "workspace.open")).toHaveLength(1)
    expect(control.request.mock.calls.filter(([method]) => method === "export.preflight" || method === "export.run")).toHaveLength(0)
  })

  it("bootstraps control after a confirmed exit and disables requests during shutdown", async () => {
    const { control, channels } = fixture()
    await channels.request("workspace.open", { mode: "persistent" })
    control.running = false
    await channels.request("workspace.saveDraft", { document_id: "document-a" })
    expect(control.request).toHaveBeenCalledWith("workspace.open", { mode: "persistent" })
    await channels.shutdown()
    expect(control.stop).toHaveBeenCalledTimes(1)
    await expect(channels.request("system.ping", {})).rejects.toMatchObject({ code: "SIDECAR_STOPPING" })
  })

  it("sends cancellation and waits for the render terminal response before stopping on quit", async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), "sztu-channels-test-"))
    try {
      const { control, render, channels } = fixture(dataRoot)
      await channels.request("workspace.open", { mode: "persistent" })
      let complete!: (result: unknown) => void
      const begun = new Promise<void>((resolve) => {
        render.request.mockImplementationOnce(async () => ({ mode: "persistent", render_ready: true }))
          .mockImplementationOnce(() => { resolve(); return new Promise((finish) => { complete = finish }) as never })
      })
      const marker = path.join(dataRoot, "cancellations", "123e4567-e89b-42d3-a456-426614174000.cancel")
      const preview = channels.request("preview.generate", { document_id: "document-a", cancellation_file: marker })
      await begun
      const shutdown = channels.shutdown()
      await vi.waitFor(async () => expect(await readFile(marker, "utf8")).toBe("cancel\n"))
      expect(control.stop).not.toHaveBeenCalled()
      expect(render.stop).not.toHaveBeenCalled()
      await expect(channels.request("workspace.saveDraft", {})).rejects.toMatchObject({ code: "SIDECAR_STOPPING" })
      complete({ cancelled: true }); await preview; await shutdown
      expect(control.stop).toHaveBeenCalledTimes(1)
      expect(render.stop).toHaveBeenCalledTimes(1)
    } finally { await rm(dataRoot, { recursive: true, force: true }) }
  })
})
