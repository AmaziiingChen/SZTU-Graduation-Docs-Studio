import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { expect, it, vi } from "vitest"
import { ACADEMIC_OPTIONS } from "../src/data/academic-options"
import { academicTelemetry } from "../electron/academic-telemetry"
import { diagnosticContext, documentStructure, validDiagnosticContext } from "../electron/diagnostic-context"
import { DIAGNOSTIC_OPERATIONS } from "../electron/diagnostics"
import { TelemetryService } from "../electron/telemetry"
const require = createRequire(import.meta.url)
const cloud = require("../../../cloudbase/functions/sztu-telemetry-ingest/index.js")
const cloudContext = require("../../../cloudbase/functions/sztu-telemetry-ingest/diagnostic-context.cjs")

it("preserves catalog and custom academic names without copying unrelated profile fields", () => {
  for (const c of ACADEMIC_OPTIONS) for (const m of c.majors) expect(academicTelemetry({ college: c.college, major: m.major, full_name: "private" })).toEqual({ college: c.college, major: m.major })
  expect(academicTelemetry({ college: "  新设学院  ", major: " 自定义专业（方向A） " })).toEqual({ college: "新设学院", major: "自定义专业（方向A）" })
  expect(academicTelemetry({ college: "", major: "新专业" })).toEqual({ college: "unknown", major: "新专业" })
  expect(academicTelemetry({ college: "音乐学院", major: "机器人工程" })).toEqual({ college: "音乐学院", major: "机器人工程" })
})

it("retains historical notice metadata without blocking upgraded telemetry and validates payload", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "telemetry-upgrade-"))
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    const batch = JSON.parse(String(init?.body))
    expect(cloud.validateBatch(batch)).toBeNull()
    expect(batch.events[0].attributes).toMatchObject({ college: "新设学院", major: "跨学科专业（新方向）".repeat(10) })
    expect(String(init?.body)).not.toMatch(/private|student123|class_name/)
    return { ok: true, status: 202 }
  })
  const options = { userDataPath: directory, appVersion: "0.1.6", platform: "darwin" as const, arch: "arm64", packaged: true, endpoint: "https://example.invalid/events", fetchImpl }
  try {
    const service = new TelemetryService(options)
    await service.initialize(); await service.acceptNotice()
    service.setAcademicProfile({ college: "新设学院", major: "跨学科专业（新方向）".repeat(10), full_name: "private", student_number: "student123", class_name: "private" })
    await service.recordUsage({ name: "view_opened", view: "advisor_review" })
    const statePath = path.join(directory, "telemetry/state.json")
    const state = JSON.parse(await readFile(statePath, "utf8")); state.notice_version = "1.1"
    await writeFile(statePath, JSON.stringify(state))
    const restarted = new TelemetryService(options); await restarted.initialize()
    expect(restarted.getPrivacyStatus().acknowledged).toBe(false)
    expect(await restarted.flush()).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it("keeps diagnostic validators aligned and strips messages, values, paths and forged frames", () => {
  const cases: unknown[] = [{}, { field: "sections.main_research_content[3].columns[1].header" }, { trace: [{ module: "exporter.py", line: 3430 }] }, { template_version: "0.3+workspace.123456abcdef" }, { field: "sections.private_name" }, { field: "/Users/private/file" }, { trace: [{ module: "private.py", line: 1 }] }, { trace: [{ module: "exporter.py", line: 1, text: "private" }] }, { structure: { paragraphs: -1 } }, { structure: { full_name: 1 } }, { message: "private" }]
  for (const item of cases) expect(validDiagnosticContext(item)).toBe(cloudContext.validDiagnosticContext(item))
  expect(diagnosticContext({ field: "sections.main_research_content[3].columns[1].header", message: "private", trace: [{ module: "/Users/private/file", line: 2 }], structure: { paragraphs: 3 } })).toEqual({ field: "sections.main_research_content[3].columns[1].header", structure: { paragraphs: 3 } })
  const structure = documentStructure({ type: "paragraph", runs: [{ text: "private" }] })
  expect(structure.paragraphs).toBe(1); expect(structure.runs).toBe(1)
  expect(JSON.stringify(structure)).not.toContain("private")
})


it("covers every main-process sidecar method in the diagnostic allowlist", async () => {
  const source = await readFile(path.join(process.cwd(), "electron/sidecar-client.ts"), "utf8")
  const methodBlock = source.split("const ALLOWED_METHODS =")[1].split("])")[0]
  for (const match of methodBlock.matchAll(/"([a-z]+\.[A-Za-z]+)"/g)) expect(DIAGNOSTIC_OPERATIONS).toContain(match[1])
})
