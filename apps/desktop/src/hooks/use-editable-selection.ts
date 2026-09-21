import { useEffect } from "react"

// Keep Select All inside editing surfaces; never select application chrome.
export function useEditableSelection() {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== "a") return
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const input = target.closest("input, textarea")
      const editable = target.closest("[contenteditable]")
      if (input || (editable && editable.getAttribute("contenteditable") !== "false")) return
      event.preventDefault()
    }
    document.addEventListener("keydown", handleKeyDown, true)
    return () => document.removeEventListener("keydown", handleKeyDown, true)
  }, [])
}
