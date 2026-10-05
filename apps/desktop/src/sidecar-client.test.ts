import { describe, expect, it } from "vitest"
import path from "node:path"

import {
  SidecarClient,
  SidecarError,
  isSidecarProgressEnvelope,
  isSidecarResponseEnvelope,
  resolveSidecarPython,
  resolveSidecarPath,
  shouldRetrySidecarRequest,
} from "../electron/sidecar-client"

const requestId = "123e4567-e89b-42d3-a456-426614174000"

describe("SidecarClient protocol boundary", () => {
  it("prefers the packaged sidecar over a repository virtual environment", () => {
    const backendRoot = "/bundle/Contents/Resources/backend"
    const packagedSidecar = path.resolve(backendRoot, "../sidecar/sztu-docs-backend")
    expect(
      resolveSidecarPython(
        backendRoot,
        undefined,
        "darwin",
        (candidate) => candidate === packagedSidecar,
      ),
    ).toBe(packagedSidecar)
  })

  it("adds standard macOS TeX and package-manager paths for Finder launches", () => {
    expect(resolveSidecarPath("/usr/bin:/bin:/usr/sbin:/sbin", "darwin").split(":"))
      .toEqual(expect.arrayContaining([
        "/usr/bin",
        "/Library/TeX/texbin",
        "/opt/homebrew/bin",
        "/usr/local/bin",
      ]))
  })

  it("does not rewrite Windows path semantics", () => {
    expect(resolveSidecarPath("C:\\Windows;C:\\Tools", "win32")).toBe(
      "C:\\Windows;C:\\Tools",
    )
  })

  it("resolves a bundled Windows executable and falls back to python", () => {
    const backendRoot = path.resolve("bundle/backend")
    const executable = path.resolve(backendRoot, "../sidecar/sztu-docs-backend.exe")
    expect(resolveSidecarPython(backendRoot, undefined, "win32", candidate => candidate === executable))
      .toBe(executable)
    expect(resolveSidecarPython(backendRoot, undefined, "win32", () => false)).toBe("python")
  })

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

  it("retries one recoverable read request but never a write", () => {
    const exited = new SidecarError("SIDECAR_EXITED", "Sidecar exited.")
    expect(shouldRetrySidecarRequest("environment.check", exited, 0)).toBe(true)
    expect(shouldRetrySidecarRequest("preview.generate", exited, 0)).toBe(true)
    expect(shouldRetrySidecarRequest("workspace.saveDraft", exited, 0)).toBe(false)
    expect(shouldRetrySidecarRequest("workspace.deleteDocument", exited, 0)).toBe(false)
    expect(shouldRetrySidecarRequest("workspace.purgeDocument", exited, 0)).toBe(false)
    expect(shouldRetrySidecarRequest("export.run", exited, 0)).toBe(false)
    expect(shouldRetrySidecarRequest("environment.check", exited, 1)).toBe(false)
  })

  it("does not retry protocol errors or timeouts", () => {
    expect(
      shouldRetrySidecarRequest(
        "environment.check",
        new SidecarError("INVALID_SIDECAR_JSON", "Invalid JSON."),
        0,
      ),
    ).toBe(false)
    expect(
      shouldRetrySidecarRequest(
        "environment.check",
        new SidecarError("REQUEST_TIMEOUT", "Timed out."),
        0,
      ),
    ).toBe(false)
  })
})
