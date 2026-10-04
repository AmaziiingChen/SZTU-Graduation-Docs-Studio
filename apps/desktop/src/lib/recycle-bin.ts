import type { DocumentListCursor, SztuDesktopApi, WorkspaceState } from "@/types/desktop-api"

export class RecycleBinClearError extends Error {
  readonly snapshot: WorkspaceState | null

  constructor(message: string, snapshot: WorkspaceState | null) {
    super(message)
    this.snapshot = snapshot
  }
}

export async function clearRecycleBin(api: Pick<SztuDesktopApi, "listDocuments" | "purgeDocument">) {
  const ids = new Set<string>()
  const cursors = new Set<string>()
  let cursor: DocumentListCursor | undefined
  // Read every page before mutations change the keyset cursor or workspace list.
  do {
    const page = await api.listDocuments({ profileId: null, deleted: true, limit: 100, ...(cursor ? { cursor } : {}) })
    if (!page.deleted || page.documents.some(document => !document.soft_deleted_at || document.is_temporary)) {
      throw new Error("回收站列表状态已变化，请重新载入后重试。")
    }
    for (const document of page.documents) ids.add(document.id)
    if (!page.has_more) break
    const next = page.next_cursor
    if (!next || cursors.has(JSON.stringify(next))) {
      throw new Error("回收站列表未能完整载入，请重试。")
    }
    cursors.add(JSON.stringify(next))
    cursor = next
  } while (cursor)

  let snapshot: WorkspaceState | null = null
  let deletedCount = 0
  try {
    // Reuse the trusted purge operation, including app-owned preview cleanup.
    for (const id of ids) {
      snapshot = await api.purgeDocument(id)
      deletedCount += 1
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "文档删除失败，请重试。"
    throw new RecycleBinClearError(`已完成 ${deletedCount} 份文档的永久删除，清空尚未完成：${message}`, snapshot)
  }
  return snapshot
}
