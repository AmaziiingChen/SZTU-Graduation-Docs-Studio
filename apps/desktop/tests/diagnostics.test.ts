import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import os from "node:os"
import { createRequire } from "node:module"
const receiver = createRequire(import.meta.url)("../../../cloudbase/functions/sztu-telemetry-ingest/index.js")
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { DiagnosticService } from "../electron/diagnostics"

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sztu-diagnostics-test-"))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe("local diagnostic package", () => {
  it("keeps structured operation evidence while removing source messages and paths", async () => {
    const userDataPath = await temporaryDirectory()
    const service = new DiagnosticService({
      userDataPath,
      appVersion: "0.1.0",
      electronVersion: "44.0.0",
      platform: "darwin",
      arch: "arm64",
      packaged: true,
      now: () => new Date("2026-08-31T12:00:00Z"),
    })
    await service.initialize()
    service.record("preview.generate", "failure", 1_500, "RENDER_FAILED", { field: "sections.main_research_content[3].columns[1].header", trace: [{ module: "exporter.py", line: 3430 }], structure: { tables: 1 }, template_version: "0.3+workspace.123456abcdef" })

    const summary = service.prepare(
      {
        ready: false,
        platform: {
          system: "Darwin",
          release: "25.0.0",
          machine: "arm64",
          python: "3.14.4",
        },
        checks: [
          {
            id: "python",
            required: true,
            status: "pass",
            message: "Python found at /Users/private-user/.venv/bin/python",
            details: { path: "/Users/private-user/.venv/bin/python" },
          },
          {
            id: "unknown_private_check",
            required: false,
            status: "warn",
            message: "student@example.test",
          },
        ],
      },
      { telemetryConfigured: true, updateConfigured: false },
    )

    const target = path.join(userDataPath, "diagnostic.json")
    await service.save(summary.reportId, target)
    await service.flush()
    const serialized = await readFile(target, "utf8")
    expect(receiver.validateDiagnosticReport(JSON.parse(serialized))).toBeNull()
    expect(receiver.scanDiagnosticReport(JSON.parse(serialized))).toBe(true)
    expect(JSON.parse(serialized).schema_version).toBe("3.0")
    expect(JSON.parse(serialized).operations.at(-1).duration_ms).toBe(1500)
    const savedMode = (await stat(target)).mode & 0o777

    expect(summary.environmentCheckCount).toBe(1)
    expect(summary.sourceFieldsRemoved).toBe(3)
    // Windows chmod exposes only the read-only bit; POSIX mode bits are not ACLs.
    if (process.platform !== "win32") expect(savedMode).toBe(0o600)
    expect(serialized).toContain('"operation": "preview.generate"')
    expect(serialized).toContain('"error_code": "RENDER_FAILED"')
    expect(serialized).toContain('"id": "python"')
    expect(serialized).not.toContain("private-user")
    expect(serialized).not.toContain("student@example.test")
    expect(serialized).not.toContain("unknown_private_check")
    expect(serialized).not.toMatch(/"(?:message|details|content|filename)"\s*:/)
  })

  it("keeps an early failed step after many successful operations and sends the detailed report", async () => {
    const userDataPath = await temporaryDirectory()
    const service = new DiagnosticService({
      userDataPath, appVersion: "0.1.13", electronVersion: "44.0.0",
      platform: "darwin", arch: "arm64", packaged: true, endpoint: "https://test.example/diagnostics",
    })
    await service.initialize()
    service.record("diagnostic.step", "failure", 120, "RENDER_FAILED", {
      stage: "preview_rasterize", tool: "pdftoppm", tool_version: "26.1.0",
      exit_code: 2, reason: "tool_nonzero", request_id: "11111111-1111-4111-8111-111111111111",
    })
    for (let i = 0; i < 230; i++) service.record("workspace.saveDraft", "success", 20)
    const environment = { ready: true, platform: { system: "Darwin", release: "25.0.0", machine: "arm64", python: "3.11.0" },
      checks: [{ id: "process_tex_packages", required: true, status: "pass" as const }] }
    const summary = service.prepare(environment, { telemetryConfigured: false, updateConfigured: false })
    const previous = globalThis.fetch
    let received: ReturnType<typeof JSON.parse>
    try {
      globalThis.fetch = async (_url, init) => {
        received = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({ ok: true, report_id: received.report_id, retention_days: 30 }), { status: 202 })
      }
      await expect(service.send(summary.reportId)).resolves.toMatchObject({ sent: true })
      expect(receiver.validateDiagnosticReport(received)).toBeNull()
      expect(received.environment.checks[0].id).toBe("process_tex_packages")
      expect(received.operations).toHaveLength(200)
      expect(received.operations[0].context).toMatchObject({ stage: "preview_rasterize", exit_code: 2, tool_version: "26.1.0" })
    } finally {
      globalThis.fetch = previous
      await service.flush()
    }
  })

})
