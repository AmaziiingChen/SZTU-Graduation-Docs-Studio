import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react"

import type { SaveState } from "@/components/workbench/save-status-badge"

type StoredDraft<T> = {
  version: 1
  value: T
}

function browserStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

function readDraft<T>(
  storageKey: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): T {
  try {
    const serialized = browserStorage()?.getItem(storageKey)
    if (!serialized) return fallback
    const stored = JSON.parse(serialized) as Partial<StoredDraft<unknown>>
    return stored.version === 1 && isValid(stored.value) ? stored.value : fallback
  } catch {
    return fallback
  }
}

function writeDraft<T>(storageKey: string, value: T): boolean {
  try {
    const storage = browserStorage()
    if (!storage) return false
    storage.setItem(storageKey, JSON.stringify({ version: 1, value } satisfies StoredDraft<T>))
    return true
  } catch {
    return false
  }
}

export function useLocalDraft<T>({
  storageKey,
  initialValue,
  isValid,
  delay = 300,
  onSaveStateChange,
}: {
  storageKey: string
  initialValue: T
  isValid: (value: unknown) => value is T
  delay?: number
  onSaveStateChange?: (state: SaveState) => void
}) {
  const initialValueRef = useRef(initialValue)
  const [value, setValueState] = useState<T>(() =>
    readDraft(storageKey, initialValue, isValid),
  )
  const [saveState, setSaveState] = useState<SaveState>("saved")
  const latestValueRef = useRef(value)
  const dirtyRef = useRef(false)

  const setValue = useCallback((next: SetStateAction<T>) => {
    dirtyRef.current = true
    setSaveState("dirty")
    setValueState((current) => {
      const resolved = typeof next === "function"
        ? (next as (previous: T) => T)(current)
        : next
      latestValueRef.current = resolved
      return resolved
    })
  }, [])

  useEffect(() => {
    if (!dirtyRef.current) return
    const timeout = window.setTimeout(() => {
      setSaveState("saving")
      const saved = writeDraft(storageKey, latestValueRef.current)
      dirtyRef.current = !saved
      setSaveState(saved ? "saved" : "error")
    }, delay)
    return () => window.clearTimeout(timeout)
  }, [delay, storageKey, value])

  useEffect(() => () => {
    if (dirtyRef.current) writeDraft(storageKey, latestValueRef.current)
  }, [storageKey])

  useEffect(() => {
    onSaveStateChange?.(saveState)
  }, [onSaveStateChange, saveState])

  const clearDraft = useCallback(() => {
    try {
      browserStorage()?.removeItem(storageKey)
      dirtyRef.current = false
      latestValueRef.current = initialValueRef.current
      setValueState(initialValueRef.current)
      setSaveState("saved")
    } catch {
      setSaveState("error")
    }
  }, [storageKey])

  return { value, setValue, saveState, clearDraft }
}
