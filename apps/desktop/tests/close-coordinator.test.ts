import { afterEach, describe, expect, it, vi } from "vitest"
import { CloseCoordinator } from "../electron/close-coordinator"

afterEach(() => vi.useRealTimers())

describe("save acknowledgement before close", () => {
  it("keeps the window alive until its own renderer confirms saving", () => {
    const requestSave = vi.fn(), onSaved = vi.fn()
    const coordinator = new CloseCoordinator({ requestSave, onSaved })
    const requestId = coordinator.request(4, "window")
    expect(requestSave).toHaveBeenCalledWith(4, requestId)
    expect(onSaved).not.toHaveBeenCalled()
    expect(coordinator.complete(5, { requestId, outcome: "saved" })).toBe(false)
    expect(coordinator.complete(4, { requestId: "old", outcome: "saved" })).toBe(false)
    expect(onSaved).not.toHaveBeenCalled()
    expect(coordinator.complete(4, { requestId, outcome: "saved" })).toBe(true)
    expect(onSaved).toHaveBeenCalledWith(4, "window")
    expect(coordinator.complete(4, { requestId, outcome: "saved" })).toBe(false)
  })

  it("combines repeated close requests and promotes an in-flight close to quit", () => {
    const requestSave = vi.fn(), onSaved = vi.fn()
    const coordinator = new CloseCoordinator({ requestSave, onSaved })
    const requestId = coordinator.request(1, "window")
    expect(coordinator.request(1, "window")).toBe(requestId)
    expect(coordinator.request(1, "quit")).toBe(requestId)
    expect(requestSave).toHaveBeenCalledTimes(1)
    coordinator.complete(1, { requestId, outcome: "saved" })
    expect(onSaved).toHaveBeenCalledWith(1, "quit")
  })

  it("does not close on a conflict, failed save, unavailable renderer or expired handshake", () => {
    vi.useFakeTimers()
    const onSaved = vi.fn(), onFailed = vi.fn()
    const coordinator = new CloseCoordinator({ requestSave: vi.fn(), onSaved, onFailed, timeoutMs: 100 })
    for (const reason of ["conflict", "save_failed"] as const) {
      const requestId = coordinator.request(3, "quit")
      expect(coordinator.complete(3, { requestId, outcome: "failed", reason })).toBe(true)
    }
    const expired = coordinator.request(3, "window")
    vi.advanceTimersByTime(100)
    expect(coordinator.complete(3, { requestId: expired, outcome: "saved" })).toBe(false)
    expect(onSaved).not.toHaveBeenCalled()
    expect(onFailed).toHaveBeenCalledTimes(3)
    const unavailable = new CloseCoordinator({ requestSave: () => { throw new Error("closed") }, onSaved, onFailed })
    unavailable.request(5, "quit")
    expect(onSaved).not.toHaveBeenCalled()
    expect(onFailed).toHaveBeenCalledWith(5)
  })

  it("does not accept a response for a window that was externally destroyed", () => {
    const onSaved = vi.fn()
    const coordinator = new CloseCoordinator({ requestSave: vi.fn(), onSaved })
    const requestId = coordinator.request(9, "window")
    coordinator.forget(9)
    expect(coordinator.complete(9, { requestId, outcome: "saved" })).toBe(false)
    expect(onSaved).not.toHaveBeenCalled()
  })
})
