import type { SztuDesktopApi } from "@/types/desktop-api"

// 与 apps/desktop/electron/preload.cts 中的常量保持一致：
// contextBridge 跨桥只保留 message，所以结构化错误随 message 一起传递。
export const DESKTOP_ERROR_ENVELOPE_PREFIX = "\u0001SZTU_DESKTOP_ERROR\u0001"

type EnvelopedErrorPayload = {
  code: string
  message: string
  details?: Record<string, unknown>
}

/**
 * 渲染进程侧的错误类型。构造在本进程（同一个 realm），所以 code/details
 * 不会被跨桥剥离；界面只显示 message，遥测与诊断包用 code/details。
 */
export class DesktopApiError extends Error {
  readonly code: string
  readonly details?: Record<string, unknown>

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = "DesktopApiError"
    this.code = code
    this.details = details
  }
}

export function decodeEnvelope(message: string): EnvelopedErrorPayload | null {
  if (!message.startsWith(DESKTOP_ERROR_ENVELOPE_PREFIX)) return null
  try {
    const payload: unknown = JSON.parse(message.slice(DESKTOP_ERROR_ENVELOPE_PREFIX.length))
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
    const record = payload as Record<string, unknown>
    if (typeof record.code !== "string" || typeof record.message !== "string") return null
    const details =
      record.details && typeof record.details === "object" && !Array.isArray(record.details)
        ? (record.details as Record<string, unknown>)
        : undefined
    return { code: record.code, message: record.message, details }
  } catch {
    return null
  }
}

/**
 * 把跨桥复制过来的错误还原成带 code/details 的 DesktopApiError。
 * 非本协议的错误原样返回，不影响既有分支。
 */
export function normalizeDesktopError(error: unknown): unknown {
  if (!(error instanceof Error)) return error
  const payload = decodeEnvelope(error.message)
  if (!payload) return error
  return new DesktopApiError(payload.code, payload.message, payload.details)
}

const wrappedApis = new WeakMap<object, SztuDesktopApi>()

function normalizeFailure(error: unknown): never {
  throw normalizeDesktopError(error)
}

/**
 * 包装 window.sztuDesktop：所有方法调用失败时先归一化错误，
 * 保证调用方拿到的是干净的 message 与可用的 code/details。
 *
 * 不能对 contextBridge 暴露的对象直接用 Proxy：它的属性是只读且不可配置的，
 * Proxy 的 get 必须返回原值，包装函数会触发 "proxy did not return its actual
 * value"，整棵 React 树崩成白屏。这里改为复制一份普通对象再包函数。
 */
export function wrapDesktopApi(raw: SztuDesktopApi): SztuDesktopApi {
  const cacheKey = raw as unknown as object
  const cached = wrappedApis.get(cacheKey)
  if (cached) return cached
  const wrapped: Record<string, unknown> = {}
  for (const name of Object.getOwnPropertyNames(raw)) {
    const value = (raw as unknown as Record<string, unknown>)[name]
    if (typeof value !== "function") {
      wrapped[name] = value
      continue
    }
    wrapped[name] = (...args: unknown[]) => {
      try {
        const result = (value as (...input: unknown[]) => unknown).apply(raw, args)
        if (result && typeof (result as PromiseLike<unknown>).then === "function") {
          return (result as PromiseLike<unknown>).then(undefined, normalizeFailure)
        }
        return result
      } catch (error) {
        return normalizeFailure(error)
      }
    }
  }
  const result = wrapped as unknown as SztuDesktopApi
  wrappedApis.set(cacheKey, result)
  return result
}
