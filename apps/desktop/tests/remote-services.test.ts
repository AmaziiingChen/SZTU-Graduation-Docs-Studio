import { createHash, generateKeyPairSync, sign } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { loadRemoteServicesConfig } from "../electron/remote-services-config"
import {
  parseTelemetryUsageEvent,
  TelemetryService,
} from "../electron/telemetry"
import {
  canonicalJson,
  compareSemver,
  parseAndVerifyManifest,
  UpdateService,
  type UpdateManifestPayload,
} from "../electron/update-service"

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sztu-remote-services-"))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe("telemetry privacy boundary", () => {
  it("accepts only exact enum events and rejects content-bearing fields", () => {
    expect(
      parseTelemetryUsageEvent({ name: "view_opened", view: "proposal" }),
    ).toEqual({ name: "view_opened", view: "proposal" })
    expect(() =>
      parseTelemetryUsageEvent({
        name: "view_opened",
        view: "proposal",
        title: "不得上传的论文题目",
      }),
    ).toThrow("invalid")
    expect(() =>
      parseTelemetryUsageEvent({
        name: "document_action",
        action: "preview",
        documentType: "proposal",
        outcome: "failure",
        errorCode: "包含 空格",
      }),
    ).toThrow("invalid")
  })

  it("does not transmit before acknowledgement and flushes a bounded schema batch after it", async () => {
    const userDataPath = await temporaryDirectory()
    const requests: string[] = []
    const service = new TelemetryService({
      userDataPath,
      appVersion: "0.1.0",
      platform: "darwin",
      arch: "arm64",
      packaged: true,
      endpoint: "https://telemetry.example.test/v1/events",
      fetchImpl: async (_url, init) => {
        requests.push(String(init?.body ?? ""))
        return { ok: true, status: 202 }
      },
      now: () => new Date("2026-08-31T00:00:00.000Z"),
    })
    await service.initialize()
    await service.recordUsage({ name: "view_opened", view: "profile" })
    expect(await service.flush()).toBe(false)
    expect(requests).toHaveLength(0)

    await service.acceptNotice()
    await service.recordUsage({ name: "view_opened", view: "profile" })
    expect(await service.flush()).toBe(true)
    expect(requests).toHaveLength(1)
    const batch = JSON.parse(requests[0]) as {
      events: Array<Record<string, unknown>>
    }
    expect(batch.events).toHaveLength(1)
    expect(batch.events[0]).toMatchObject({
      name: "usage_event",
      app_version: "0.1.0",
      platform: "darwin",
      arch: "arm64",
      attributes: { event_name: "view_opened", view: "profile" },
    })
    expect(JSON.stringify(batch)).not.toContain("full_name")
    expect(JSON.parse(await readFile(path.join(userDataPath, "telemetry", "queue.json"), "utf8"))).toEqual([])
  })

  it("records each local document completion once without transmitting its identifier", async () => {
    const userDataPath = await temporaryDirectory()
    const requests: Array<{ url: string; body: string }> = []
    const aggregateRequests: string[] = []
    const service = new TelemetryService({
      userDataPath,
      appVersion: "0.1.0",
      platform: "darwin",
      arch: "arm64",
      packaged: true,
      endpoint: "https://telemetry.example.test/v1/events",
      fetchImpl: async (url, init) => {
        if (init?.method === "GET") {
          aggregateRequests.push(url)
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, completed_documents: 42 }),
          }
        }
        requests.push({ url, body: String(init?.body ?? "") })
        return { ok: true, status: 202 }
      },
      now: () => new Date("2026-08-31T00:00:00.000Z"),
    })
    await service.initialize()
    await service.acceptNotice()
    const documentId = "11111111-1111-4111-8111-111111111111"

    await expect(
      service.recordDocumentCompletion(documentId, "proposal"),
    ).resolves.toEqual({ recorded: true, total: 42 })
    await expect(
      service.recordDocumentCompletion(documentId, "proposal"),
    ).resolves.toEqual({ recorded: false, total: 42 })

    expect(requests).toHaveLength(1)
    expect(aggregateRequests).toEqual([
      "https://telemetry.example.test/v1/events?aggregate=completed_documents",
      "https://telemetry.example.test/v1/events?aggregate=completed_documents",
    ])
    expect(requests[0].url).toBe("https://telemetry.example.test/v1/events")
    expect(requests[0].body).toContain('"event_name":"document_completed"')
    expect(requests[0].body).not.toContain(documentId)
  })
})

describe("signed updates", () => {
  const payload: UpdateManifestPayload = {
    schema_version: "1.0",
    channel: "stable",
    version: "0.2.0",
    published_at: "2026-08-31T00:00:00.000Z",
    artifacts: [
      {
        platform: "darwin",
        arch: "arm64",
        url: "https://downloads.example.test/sztu-docs-0.2.0.dmg",
        sha256: "0".repeat(64),
        size_bytes: 1,
      },
    ],
  }

  it("verifies Ed25519 before trusting manifest fields", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519")
    const envelope = {
      payload,
      signature: sign(
        null,
        Buffer.from(canonicalJson(payload), "utf8"),
        privateKey,
      ).toString("base64"),
    }
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString()
    expect(parseAndVerifyManifest(envelope, publicKeyPem)).toEqual(payload)
    expect(() =>
      parseAndVerifyManifest(
        { ...envelope, payload: { ...payload, version: "9.9.9" } },
        publicKeyPem,
      ),
    ).toThrow("verification failed")
  })

  it("compares release versions before downloading", () => {
    expect(compareSemver("0.2.0", "0.1.9")).toBeGreaterThan(0)
    expect(compareSemver("0.2.0", "0.2.0")).toBe(0)
    expect(compareSemver("0.2.0-beta.1", "0.2.0")).toBeLessThan(0)
  })

  it("downloads only the signed platform artifact and verifies its bytes", async () => {
    const userDataPath = await temporaryDirectory()
    const artifactBytes = Buffer.from("verified update bytes")
    const { privateKey, publicKey } = generateKeyPairSync("ed25519")
    const signedPayload: UpdateManifestPayload = {
      ...payload,
      artifacts: [
        {
          ...payload.artifacts[0],
          sha256: createHash("sha256").update(artifactBytes).digest("hex"),
          size_bytes: artifactBytes.length,
        },
      ],
    }
    const envelope = {
      payload: signedPayload,
      signature: sign(
        null,
        Buffer.from(canonicalJson(signedPayload), "utf8"),
        privateKey,
      ).toString("base64"),
    }
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith("manifest.json")
        ? new Response(JSON.stringify(envelope), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        : new Response(artifactBytes, { status: 200 }),
    )
    const service = new UpdateService({
      userDataPath,
      currentVersion: "0.1.0",
      platform: "darwin",
      arch: "arm64",
      manifestUrl: "https://downloads.example.test/manifest.json",
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      fetchImpl,
    })
    expect(await service.checkNow()).toMatchObject({
      state: "downloaded",
      version: "0.2.0",
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const downloadedPath = service.revealDownloadedPath()
    expect(downloadedPath).not.toBeNull()
    expect(await readFile(downloadedPath!)).toEqual(artifactBytes)

    expect(await service.checkNow()).toMatchObject({
      state: "downloaded",
      version: "0.2.0",
    })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})

describe("remote service configuration", () => {
  it("uses the deployed CloudBase telemetry endpoint by default in development", async () => {
    const config = await loadRemoteServicesConfig({
      packaged: false,
      resourcesPath: "/unused",
      environment: {},
    })
    expect(config.telemetryEndpoint).toBe(
      "https://amazingapp-d5giro9ac73398410-1412347033.ap-shanghai.app.tcloudbase.com/api/telemetry/v1/events",
    )
    expect(config.diagnosticEndpoint).toBe(
      "https://amazingapp-d5giro9ac73398410-1412347033.ap-shanghai.app.tcloudbase.com/api/diagnostics/v1/reports",
    )
  })

  it("allows loopback HTTP only in development and never requires client secrets", async () => {
    const config = await loadRemoteServicesConfig({
      packaged: false,
      resourcesPath: "/unused",
      environment: {
        SZTU_TELEMETRY_ENDPOINT: "http://127.0.0.1:8787/v1/events",
      },
    })
    expect(config.telemetryEndpoint).toBe("http://127.0.0.1:8787/v1/events")
    await expect(
      loadRemoteServicesConfig({
        packaged: false,
        resourcesPath: "/unused",
        environment: {
          SZTU_TELEMETRY_ENDPOINT: "http://example.test/v1/events",
        },
      }),
    ).rejects.toThrow("HTTPS")
  })
})
