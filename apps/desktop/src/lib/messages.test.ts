import { describe, expect, it } from "vitest"

import {
  activeNotices,
  compareVersions,
  isNoticeActive,
  loadReadNoticeIds,
  markNoticeRead,
  MESSAGE_READ_STORAGE_KEY,
  saveReadNoticeIds,
  unreadCount,
} from "./messages"
import type { ReleaseNotice } from "@/types/desktop-api"

const notice = (overrides: Partial<ReleaseNotice> = {}): ReleaseNotice => ({
  id: "notice-1",
  title: "帮助中心已上线",
  body: "现在可以在应用内查看使用说明。",
  imageUrl: null,
  severity: "info",
  startsAt: "2026-11-01T00:00:00Z",
  endsAt: null,
  minVersion: null,
  maxVersion: null,
  actions: [],
  ...overrides,
})

const memoryStorage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

describe("compareVersions", () => {
  it("orders releases by numeric segments", () => {
    expect(compareVersions("0.2.0", "0.2.0")).toBe(0)
    expect(compareVersions("0.2.0", "0.1.19")).toBe(1)
    expect(compareVersions("0.9.9", "0.10.0")).toBe(-1)
  })

  it("sorts a prerelease before its release and ignores build metadata", () => {
    expect(compareVersions("0.2.0-dev.2", "0.2.0")).toBe(-1)
    expect(compareVersions("0.2.0-dev.2", "0.2.0-dev.2+build.7")).toBe(0)
  })
})

describe("notice visibility", () => {
  const now = new Date("2026-11-26T04:00:00Z")

  it("hides notices before their window or after it ends", () => {
    expect(isNoticeActive(notice({ startsAt: "2026-12-01T00:00:00Z" }), "0.2.0", now)).toBe(false)
    expect(isNoticeActive(notice({ endsAt: "2026-11-01T00:00:00Z" }), "0.2.0", now)).toBe(false)
    expect(isNoticeActive(notice({ endsAt: "2026-12-01T00:00:00Z" }), "0.2.0", now)).toBe(true)
  })

  it("applies version windows inclusively", () => {
    const scoped = notice({ minVersion: "0.2.0", maxVersion: "0.2.9" })
    expect(isNoticeActive(scoped, "0.1.19", now)).toBe(false)
    expect(isNoticeActive(scoped, "0.2.0", now)).toBe(true)
    expect(isNoticeActive(scoped, "0.2.9", now)).toBe(true)
    expect(isNoticeActive(scoped, "0.3.0", now)).toBe(false)
  })

  it("sorts active notices newest first", () => {
    const older = notice({ id: "older", startsAt: "2026-11-01T00:00:00Z" })
    const newer = notice({ id: "newer", startsAt: "2026-11-20T00:00:00Z" })
    expect(activeNotices([older, newer], "0.2.0", now).map((item) => item.id)).toEqual([
      "newer",
      "older",
    ])
  })
})

describe("read state", () => {
  it("persists read ids and computes the unread count", () => {
    const storage = memoryStorage()
    expect(loadReadNoticeIds(storage)).toEqual([])
    const stored = saveReadNoticeIds(["a", "a", "b"], storage)
    expect(stored).toEqual(["a", "b"])
    expect(JSON.parse(storage.getItem(MESSAGE_READ_STORAGE_KEY) ?? "[]")).toEqual(["a", "b"])
    expect(loadReadNoticeIds(storage)).toEqual(["a", "b"])
    expect(unreadCount([notice({ id: "a" }), notice({ id: "b" }), notice({ id: "c" })], ["a", "b"])).toBe(1)
  })

  it("moves a re-read notice to the end", () => {
    const storage = memoryStorage()
    saveReadNoticeIds(["a", "b"], storage)
    expect(markNoticeRead(["a", "b"], "a")).toEqual(["b", "a"])
  })

  it("ignores invalid stored payloads", () => {
    const storage = memoryStorage()
    storage.setItem(MESSAGE_READ_STORAGE_KEY, "{not-json")
    expect(loadReadNoticeIds(storage)).toEqual([])
    storage.setItem(MESSAGE_READ_STORAGE_KEY, JSON.stringify(["ok", 3, null]))
    expect(loadReadNoticeIds(storage)).toEqual(["ok"])
  })
})
