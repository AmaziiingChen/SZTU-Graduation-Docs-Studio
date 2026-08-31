import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import os from "node:os"
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
    service.record("preview.generate", "failure", 1_500, "RENDER_FAILED")

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
    const savedMode = (await stat(target)).mode & 0o777

    expect(summary.environmentCheckCount).toBe(1)
    expect(summary.sourceFieldsRemoved).toBe(3)
    expect(savedMode).toBe(0o600)
    expect(serialized).toContain('"operation": "preview.generate"')
    expect(serialized).toContain('"error_code": "RENDER_FAILED"')
    expect(serialized).toContain('"id": "python"')
    expect(serialized).not.toContain("private-user")
    expect(serialized).not.toContain("student@example.test")
    expect(serialized).not.toContain("unknown_private_check")
    expect(serialized).not.toMatch(/"(?:message|details|content|filename)"\s*:/)
  })
})
