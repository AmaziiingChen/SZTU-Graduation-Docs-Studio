import { randomUUID } from "node:crypto"

export type CloseIntent = "window" | "quit"
export type CloseOutcome = {
  requestId: string
  outcome: "saved" | "failed"
  reason?: "conflict" | "save_failed"
}

type PendingClose = {
  requestId: string
  windowId: number
  intent: CloseIntent
  timer: ReturnType<typeof setTimeout>
}

/** The main process never destroys an editing surface before save acknowledgement. */
export class CloseCoordinator {
  private pending: PendingClose | undefined

  constructor(private readonly options: {
    requestSave: (windowId: number, requestId: string) => void
    onSaved: (windowId: number, intent: CloseIntent) => void
    onFailed?: (windowId: number) => void
    timeoutMs?: number
  }) {}

  request(windowId: number, intent: CloseIntent): string {
    if (this.pending?.windowId === windowId) {
      if (intent === "quit") this.pending.intent = "quit"
      return this.pending.requestId
    }
    this.clearPending()
    const requestId = randomUUID()
    const timer = setTimeout(() => {
      if (this.pending?.requestId !== requestId) return
      this.clearPending()
      this.options.onFailed?.(windowId)
    }, this.options.timeoutMs ?? 60_000)
    timer.unref?.()
    this.pending = { requestId, windowId, intent, timer }
    try {
      this.options.requestSave(windowId, requestId)
    } catch {
      this.clearPending()
      this.options.onFailed?.(windowId)
    }
    return requestId
  }

  complete(windowId: number, outcome: CloseOutcome): boolean {
    const pending = this.pending
    if (!pending || pending.windowId !== windowId || pending.requestId !== outcome.requestId) return false
    this.clearPending()
    if (outcome.outcome === "saved") this.options.onSaved(windowId, pending.intent)
    else this.options.onFailed?.(windowId)
    return true
  }

  forget(windowId: number): void {
    if (this.pending?.windowId === windowId) this.clearPending()
  }

  private clearPending(): void {
    if (this.pending) clearTimeout(this.pending.timer)
    this.pending = undefined
  }
}
