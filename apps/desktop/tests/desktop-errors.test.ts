import { describe, expect, it, vi } from "vitest"

import type { SztuDesktopApi } from "../src/types/desktop-api"
import {
  DESKTOP_ERROR_ENVELOPE_PREFIX,
  DesktopApiError,
  decodeEnvelope,
  normalizeDesktopError,
  wrapDesktopApi,
} from "../src/lib/desktop-errors"

function encode(code: string, message: string, details?: Record<string, unknown>): string {
  return `${DESKTOP_ERROR_ENVELOPE_PREFIX}${JSON.stringify({ code, message, details: details ?? null })}`
}

function fakeApi(overrides: Record<string, unknown>): SztuDesktopApi {
  return overrides as unknown as SztuDesktopApi
}

describe("desktop error envelopes", () => {
  it("decodes a structured error passed across the context bridge", () => {
    const decoded = decodeEnvelope(
      encode("REQUIRED_FONT_MISSING", "论文模板缺少规定字体。", { reason: "font" }),
    )
    expect(decoded).toEqual({
      code: "REQUIRED_FONT_MISSING",
      message: "论文模板缺少规定字体。",
      details: { reason: "font" },
    })
  })

  it("ignores plain messages and malformed envelopes", () => {
    expect(decodeEnvelope("排版预览生成失败。")).toBeNull()
    expect(decodeEnvelope(`${DESKTOP_ERROR_ENVELOPE_PREFIX}{`)).toBeNull()
    expect(decodeEnvelope(`${DESKTOP_ERROR_ENVELOPE_PREFIX}${JSON.stringify({ code: "" })}`)).toBeNull()
  })

  it("wraps rejected calls into a renderer-side error that keeps code and details", async () => {
    const api = fakeApi({
      systemPing: vi.fn().mockRejectedValue(
        new Error(encode("RENDER_FAILED", "文档生成失败，请重试。", { diagnostic_case_id: "case-1" })),
      ),
    })
    const wrapped = wrapDesktopApi(api)

    const error = await wrapped.systemPing().catch((value: unknown) => value)
    expect(error).toBeInstanceOf(DesktopApiError)
    expect(error).toMatchObject({
      code: "RENDER_FAILED",
      message: "文档生成失败，请重试。",
      details: { diagnostic_case_id: "case-1" },
    })
    expect((error as Error).message).not.toContain("RENDER_FAILED")
  })

  it("wraps synchronous throws as well as rejected promises", () => {
    const api = fakeApi({
      getDocument: () => {
        throw new Error(encode("RESULT_STALE", "结果已过期，请重试。"))
      },
    })

    let caught: unknown = null
    try {
      wrapDesktopApi(api).getDocument("id")
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(DesktopApiError)
    expect((caught as DesktopApiError).code).toBe("RESULT_STALE")
    expect((caught as Error).message).toBe("结果已过期，请重试。")
  })

  it("passes through unrelated errors unchanged", async () => {
    const original = new TypeError("boom")
    const api = fakeApi({ systemPing: vi.fn().mockRejectedValue(original) })

    await expect(wrapDesktopApi(api).systemPing()).rejects.toBe(original)
  })

  it("returns the same proxy for the same raw api object", () => {
    const api = fakeApi({})
    expect(wrapDesktopApi(api)).toBe(wrapDesktopApi(api))
  })

  it("leaves successful values untouched", async () => {
    const api = fakeApi({ systemPing: vi.fn().mockResolvedValue({ ok: true }) })
    await expect(wrapDesktopApi(api).systemPing()).resolves.toEqual({ ok: true })
  })

  it("normalizes an envelope-shaped message without a code", () => {
    expect(normalizeDesktopError(new Error("plain failure"))).toBeInstanceOf(Error)
    const normalized = normalizeDesktopError(
      new Error(encode("ENGINE_PATH_UNSUPPORTED", "编译环境缺失或安装在不支持的位置。")),
    )
    expect(normalized).toBeInstanceOf(DesktopApiError)
    expect((normalized as DesktopApiError).code).toBe("ENGINE_PATH_UNSUPPORTED")
  })
})
