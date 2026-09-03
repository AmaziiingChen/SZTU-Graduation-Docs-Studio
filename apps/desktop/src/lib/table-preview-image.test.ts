import { afterEach, describe, expect, it, vi } from "vitest"

import { copyTablePreviewPng, renderTablePreviewPng } from "@/lib/table-preview-image"

afterEach(() => vi.restoreAllMocks())

function installCanvasMock() {
  const context = {
    beginPath: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    measureText: (text: string) => ({ width: text.length * 8 }),
    moveTo: vi.fn(),
    scale: vi.fn(),
    stroke: vi.fn(),
    fillStyle: "",
    font: "",
    lineWidth: 1,
    strokeStyle: "",
    textAlign: "left",
    textBaseline: "alphabetic",
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toBlob: vi.fn((callback: BlobCallback) => callback(new Blob(["png"], { type: "image/png" }))),
  }
  const createElement = document.createElement.bind(document)
  vi.spyOn(document, "createElement").mockImplementation(((tagName: string) =>
    tagName === "canvas" ? canvas : createElement(tagName)) as typeof document.createElement)
  return { canvas, context }
}

describe("table preview PNG", () => {
  it("renders a high-resolution PNG from the table structure", async () => {
    const { canvas, context } = installCanvasMock()

    const blob = await renderTablePreviewPng({
      rows: [["指标", "数值"], ["准确率", "92.4"]],
      caption: "实验结果",
      headerRows: 1,
      style: "three-line",
    })

    expect(blob.type).toBe("image/png")
    expect(canvas.width).toBeGreaterThan(0)
    expect(canvas.height).toBeGreaterThan(0)
    expect(context.scale).toHaveBeenCalledWith(2, 2)
    expect(context.fillText).toHaveBeenCalledWith("实验结果", expect.any(Number), expect.any(Number))
    expect(context.stroke).toHaveBeenCalledTimes(3)
  })

  it("writes the rendered PNG to the system clipboard", async () => {
    installCanvasMock()
    const write = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write } })
    class ClipboardItemMock {
      constructor(readonly data: Record<string, Blob>) {}
    }
    Object.defineProperty(globalThis, "ClipboardItem", { configurable: true, value: ClipboardItemMock })

    await copyTablePreviewPng({
      rows: [["指标", "数值"], ["准确率", "92.4"]],
      headerRows: 1,
      style: "grid",
    })

    expect(write).toHaveBeenCalledOnce()
    const item = write.mock.calls[0][0][0] as ClipboardItemMock
    expect(item.data["image/png"]).toBeInstanceOf(Blob)
  })
})
