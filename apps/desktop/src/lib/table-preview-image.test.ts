import { afterEach, describe, expect, it, vi } from "vitest"

import {
  copyTablePreviewPng,
  downloadTablePreviewPng,
  renderTablePreviewPng,
} from "@/lib/table-preview-image"

afterEach(() => {
  vi.restoreAllMocks()
  delete (window as Window & { sztuDesktop?: unknown }).sztuDesktop
})

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
    const writeClipboardPng = vi.fn().mockResolvedValue(null)
    Object.defineProperty(window, "sztuDesktop", {
      configurable: true,
      value: { writeClipboardPng },
    })

    await copyTablePreviewPng({
      rows: [["指标", "数值"], ["准确率", "92.4"]],
      headerRows: 1,
      style: "grid",
    })

    expect(writeClipboardPng).toHaveBeenCalledOnce()
    expect(writeClipboardPng.mock.calls[0][0]).toMatch(/^data:image\/png;base64,/)
  })

  it("downloads the rendered PNG with the requested filename", async () => {
    installCanvasMock()
    const createObjectURL = vi.fn(() => "blob:table-preview")
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)

    await downloadTablePreviewPng({
      rows: [["指标", "数值"], ["准确率", "92.4"]],
      headerRows: 1,
      style: "grid",
    }, "table.png")

    expect(click).toHaveBeenCalledOnce()
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:table-preview")
  })
})
