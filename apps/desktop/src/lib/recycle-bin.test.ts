import { describe, expect, it, vi } from "vitest"
import { clearRecycleBin, RecycleBinClearError } from "@/lib/recycle-bin"
import type { DocumentRecord, DocumentListResult, WorkspaceState } from "@/types/desktop-api"

const record = (id: string, profileId = "profile-a") => ({ id, profile_id: profileId, soft_deleted_at: "2026-10-04T00:00:00Z", is_temporary: false } as DocumentRecord)
const page = (documents: DocumentRecord[], hasMore = false, nextId = "next"): DocumentListResult => ({ documents, deleted: true, profile_id: null, has_more: hasMore, next_cursor: hasMore ? { id: nextId, updated_at: "2026-10-04T00:00:00Z" } : null })
const snapshot = { deleted_documents: [], documents: [record("active")], mode: "persistent" } as unknown as WorkspaceState

describe("clearRecycleBin", () => {
  it("loads every page across profiles before purging each unique recycled document", async () => {
    const first = Array.from({ length: 100 }, (_, index) => record(`trash-${index}`))
    const second = [...Array.from({ length: 25 }, (_, index) => record(`trash-${index + 100}`, "profile-b")), first[99]]
    const listDocuments = vi.fn().mockResolvedValueOnce(page(first, true)).mockResolvedValueOnce(page(second))
    const purgeDocument = vi.fn().mockImplementation(async () => {
      expect(listDocuments).toHaveBeenCalledTimes(2)
      return snapshot
    })
    expect(await clearRecycleBin({ listDocuments, purgeDocument })).toBe(snapshot)
    expect(listDocuments).toHaveBeenNthCalledWith(1, { profileId: null, deleted: true, limit: 100 })
    expect(listDocuments).toHaveBeenNthCalledWith(2, { profileId: null, deleted: true, limit: 100, cursor: { id: "next", updated_at: "2026-10-04T00:00:00Z" } })
    expect(purgeDocument).toHaveBeenCalledTimes(125)
    expect(new Set(purgeDocument.mock.calls.map(([id]) => id)).size).toBe(125)
  })

  it("does not delete anything if a later page cannot be read", async () => {
    const api = { listDocuments: vi.fn().mockResolvedValueOnce(page([record("a")], true)).mockRejectedValueOnce(new Error("载入失败")), purgeDocument: vi.fn() }
    await expect(clearRecycleBin(api)).rejects.toThrow("载入失败")
    expect(api.purgeDocument).not.toHaveBeenCalled()
  })

  it.each([page([{ ...record("active"), soft_deleted_at: null }]), page([record("a")], true)])("rejects unsafe records or repeated cursors before deletion", async (result) => {
    const api = { listDocuments: vi.fn().mockResolvedValue(result), purgeDocument: vi.fn() }
    await expect(clearRecycleBin(api)).rejects.toThrow()
    expect(api.purgeDocument).not.toHaveBeenCalled()
  })

  it("reports partial completion and keeps the latest snapshot when a purge fails", async () => {
    const api = { listDocuments: vi.fn().mockResolvedValue(page([record("a"), record("b"), record("c")])), purgeDocument: vi.fn().mockResolvedValueOnce(snapshot).mockRejectedValueOnce(new Error("写入失败")) }
    const error = await clearRecycleBin(api).catch(error => error)
    expect(error).toBeInstanceOf(RecycleBinClearError)
    expect(error.snapshot).toBe(snapshot)
    expect(error.message).toContain("已完成 1 份")
    expect(error.message).toContain("写入失败")
    expect(api.purgeDocument).toHaveBeenCalledTimes(2)
  })

  it("skips deletion for an already empty recycle bin", async () => {
    const api = { listDocuments: vi.fn().mockResolvedValue(page([])), purgeDocument: vi.fn() }
    expect(await clearRecycleBin(api)).toBeNull()
    expect(api.purgeDocument).not.toHaveBeenCalled()
  })
})
