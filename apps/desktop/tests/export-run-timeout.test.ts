import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { EXPORT_RUN_TIMEOUT_MS, normalizeExportRunError } from "../electron/export-run"
import { SidecarError } from "../electron/sidecar-client"

describe("export.run client deadline", () => {
  it("stays above the backend thesis render budget", () => {
    // backend/src/sztu_docs_backend/exporter.py:3875 给论文的 LaTeX 渲染 300 秒。
    const backendThesisBudgetMs = 300_000
    expect(EXPORT_RUN_TIMEOUT_MS).toBeGreaterThanOrEqual(330_000)
    expect(EXPORT_RUN_TIMEOUT_MS).toBeGreaterThan(backendThesisBudgetMs)
    // 非论文文档的后端预算是 90 秒（要求 >= 150_000），统一上限同样覆盖。
    expect(EXPORT_RUN_TIMEOUT_MS).toBeGreaterThanOrEqual(150_000)
  })

  it("is actually wired into the export handler without the old 120 s deadline", () => {
    // jsdom sets import.meta.url to an http: URL, so resolve from the package root.
    const source = readFileSync(resolve(process.cwd(), "electron/main.ts"), "utf8")
    const start = source.indexOf('ipcMain.handle("sztu:export-document"')
    const end = source.indexOf('ipcMain.handle("sztu:export-cancel"', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const handler = source.slice(start, end)
    expect(handler).toContain("requestSidecar(\"export.run\", params, EXPORT_RUN_TIMEOUT_MS)")
    expect(handler).toContain("normalizeExportRunError")
    expect(handler).not.toContain("requestSidecar(\"export.run\", params, 120_000)")
    // 取消标记必须在请求结束后清理，不能残留 running 任务的取消文件。
    expect(handler).toContain("activeCancellationFiles.delete")
    expect(handler).toContain("removeCancellationMarker(marker)")
  })

  it.each(["REQUEST_TIMEOUT", "REQUEST_OUTCOME_UNKNOWN", "RENDER_TIMEOUT"])(
    "maps %s to the stable EXPORT_TIMEOUT code",
    (code) => {
      const original = new SidecarError(code, "原始超时消息", { stage: "pdf_compile" })
      original.diagnosticCaseId = "00000000-0000-4000-8000-000000000000"
      const mapped = normalizeExportRunError(original)
      expect(mapped).toBeInstanceOf(SidecarError)
      const error = mapped as SidecarError
      expect(error.code).toBe("EXPORT_TIMEOUT")
      expect(error.details).toMatchObject({ stage: "pdf_compile", original_code: code })
      expect(error.diagnosticCaseId).toBe(original.diagnosticCaseId)
      expect(error.message).toContain("导出超时")
      expect(error.message).toContain("导出记录")
    },
  )

  it("leaves cancellations and unrelated failures untouched", () => {
    const cancelled = new SidecarError("EXPORT_CANCELLED", "已取消")
    expect(normalizeExportRunError(cancelled)).toBe(cancelled)
    const busy = new SidecarError("RENDER_BUSY", "文档正在生成预览或导出。")
    expect(normalizeExportRunError(busy)).toBe(busy)
    const generic = new Error("boom")
    expect(normalizeExportRunError(generic)).toBe(generic)
  })
})
