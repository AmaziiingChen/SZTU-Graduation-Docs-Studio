import { afterEach, describe, expect, it, vi } from "vitest"
import confetti from "canvas-confetti"
const { fire } = vi.hoisted(() => ({ fire: vi.fn() }))
import { celebrateExportSuccess } from "./export-celebration"
vi.mock("canvas-confetti", () => ({ default: { create: vi.fn(() => fire) } }))
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })
describe("export celebration", () => {
  it("plays one finite burst", () => {
    celebrateExportSuccess()
    expect(confetti.create).toHaveBeenCalledWith(undefined, { useWorker: false, resize: true })
    expect(fire).toHaveBeenCalledTimes(1)
    expect(fire).toHaveBeenCalledWith(expect.objectContaining({ disableForReducedMotion: true, ticks: 150 }))
  })
  it("respects reduced motion", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList)
    celebrateExportSuccess()
    expect(fire).not.toHaveBeenCalled()
  })
  it("does not fail the export if canvas rendering fails", () => {
    fire.mockImplementationOnce(() => { throw new Error("canvas unavailable") })
    expect(celebrateExportSuccess).not.toThrow()
  })
})
