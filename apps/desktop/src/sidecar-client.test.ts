import { describe, expect, it } from "vitest"

import {
  SidecarClient,
  isSidecarProgressEnvelope,
  isSidecarResponseEnvelope,
} from "../electron/sidecar-client"

const requestId = "123e4567-e89b-42d3-a456-426614174000"

describe("SidecarClient protocol boundary", () => {
  it("accepts exact success and error envelopes with UUID ids", () => {
    expect(
      isSidecarResponseEnvelope({
        protocol: "1.0",
        id: requestId,
        ok: true,
        result: { saved: true },
      }),
    ).toBe(true)
    expect(
      isSidecarResponseEnvelope({
        protocol: "1.0",
        id: requestId,
        ok: false,
        error: {
          code: "REVISION_CONFLICT",
          message: "Draft changed.",
          details: { expected_revision: 1, actual_revision: 2 },
        },
      }),
    ).toBe(true)
  })

  it("rejects integer, arbitrary string and extra envelope fields", () => {
    for (const id of [1, "next", "开题报告"]) {
      expect(
        isSidecarResponseEnvelope({ protocol: "1.0", id, ok: true, result: {} }),
      ).toBe(false)
    }
    expect(
      isSidecarResponseEnvelope({
        protocol: "1.0",
        id: requestId,
        ok: true,
        result: {},
        debug: "must not cross the boundary",
      }),
    ).toBe(false)
  })

  it("rejects malformed error and progress envelopes", () => {
    expect(
      isSidecarResponseEnvelope({
        protocol: "1.0",
        id: requestId,
        ok: false,
        error: { code: "lowercase", message: "bad" },
      }),
    ).toBe(false)
    expect(
      isSidecarProgressEnvelope({
        protocol: "1.0",
        event: "request.progress",
        request_id: requestId,
        progress: { current: 3, total: 2, message: "invalid" },
      }),
    ).toBe(false)
  })

  it("rejects methods outside the explicit allowlist before spawning", async () => {
    const client = new SidecarClient("/not-used", "/not-used")
    const request = client.request as unknown as (
      method: string,
      params?: Record<string, unknown>,
    ) => Promise<unknown>
    await expect(request("document.teleport")).rejects.toMatchObject({
      code: "INVALID_METHOD",
    })
  })
})
