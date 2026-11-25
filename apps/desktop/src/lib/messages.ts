import type { ReleaseNotice } from "@/types/desktop-api"

export const MESSAGE_READ_STORAGE_KEY = "sztu-docs.messages-read-v1"
const MAX_READ_IDS = 200

const splitVersion = (value: string) => {
  const withoutBuild = value.trim().split("+")[0] ?? ""
  const dashAt = withoutBuild.indexOf("-")
  const core = dashAt === -1 ? withoutBuild : withoutBuild.slice(0, dashAt)
  const prerelease = dashAt === -1 ? "" : withoutBuild.slice(dashAt + 1)
  return { core, prerelease }
}

/** Compare two semver-like version strings. Prerelease sorts before its release. */
export function compareVersions(left: string, right: string): number {
  const a = splitVersion(left)
  const b = splitVersion(right)
  const aParts = a.core.split(".")
  const bParts = b.core.split(".")
  for (let index = 0; index < 3; index += 1) {
    const aNumber = Number(aParts[index] ?? "0")
    const bNumber = Number(bParts[index] ?? "0")
    const aValue = Number.isFinite(aNumber) ? aNumber : 0
    const bValue = Number.isFinite(bNumber) ? bNumber : 0
    if (aValue !== bValue) return aValue < bValue ? -1 : 1
  }
  if (a.prerelease === b.prerelease) return 0
  if (!a.prerelease) return 1
  if (!b.prerelease) return -1
  return a.prerelease < b.prerelease ? -1 : 1
}

export function isNoticeActive(
  notice: ReleaseNotice,
  appVersion: string,
  now: Date = new Date(),
): boolean {
  const startsAt = Date.parse(notice.startsAt)
  if (Number.isFinite(startsAt) && startsAt > now.getTime()) return false
  if (notice.endsAt) {
    const endsAt = Date.parse(notice.endsAt)
    if (Number.isFinite(endsAt) && endsAt <= now.getTime()) return false
  }
  if (notice.minVersion && compareVersions(appVersion, notice.minVersion) < 0) return false
  if (notice.maxVersion && compareVersions(appVersion, notice.maxVersion) > 0) return false
  return true
}

export function activeNotices(
  notices: ReleaseNotice[],
  appVersion: string,
  now: Date = new Date(),
): ReleaseNotice[] {
  return notices
    .filter((notice) => isNoticeActive(notice, appVersion, now))
    .slice()
    .sort((left, right) => {
      const byStart = Date.parse(right.startsAt) - Date.parse(left.startsAt)
      return byStart !== 0 ? byStart : left.id.localeCompare(right.id)
    })
}

type ReadStorage = Pick<Storage, "getItem" | "setItem">

const defaultStorage = (): ReadStorage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

export function loadReadNoticeIds(storage: ReadStorage | null = defaultStorage()): string[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(MESSAGE_READ_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === "string").slice(-MAX_READ_IDS)
  } catch {
    return []
  }
}

export function saveReadNoticeIds(
  ids: string[],
  storage: ReadStorage | null = defaultStorage(),
): string[] {
  const next = Array.from(new Set(ids.filter((id) => id.trim().length > 0))).slice(-MAX_READ_IDS)
  if (storage) {
    try {
      storage.setItem(MESSAGE_READ_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Storage may be unavailable; the badge is cosmetic and must not break the app.
    }
  }
  return next
}

export function markNoticeRead(ids: string[], noticeId: string): string[] {
  return saveReadNoticeIds([...ids.filter((id) => id !== noticeId), noticeId])
}

export function unreadCount(notices: ReleaseNotice[], readIds: string[]): number {
  const read = new Set(readIds)
  return notices.reduce((total, notice) => (read.has(notice.id) ? total : total + 1), 0)
}
