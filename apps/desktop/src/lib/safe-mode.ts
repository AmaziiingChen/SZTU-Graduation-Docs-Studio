export const SAFE_MODE_STORAGE_KEY = "sztu-docs.safe-mode"

export function isSafeMode(): boolean {
  try {
    return window.localStorage.getItem(SAFE_MODE_STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

export function enableSafeMode(): void {
  try {
    window.localStorage.setItem(SAFE_MODE_STORAGE_KEY, "1")
  } catch {
    // Storage can be unavailable; safe mode then only lasts for this reload.
  }
}

export function disableSafeMode(): void {
  try {
    window.localStorage.removeItem(SAFE_MODE_STORAGE_KEY)
  } catch {
    // Nothing to clear.
  }
}
