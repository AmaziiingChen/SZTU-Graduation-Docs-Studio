import { afterEach, describe, expect, it, vi } from "vitest"

import { recoverManagedImagePreview } from "@/lib/managed-image-preview"

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe("managed image preview recovery", () => {
  it("uses the verified desktop fallback after a private asset URL fails", async () => {
    const fileName = `${"a".repeat(64)}.png`
    const image = document.createElement("img")
    image.src = `sztu-asset://asset/${fileName}`
    document.body.append(image)
    const readImageAssetPreview = vi.fn().mockResolvedValue("data:image/png;base64,aGVsbG8=")
    vi.stubGlobal("sztuDesktop", { readImageAssetPreview })

    await recoverManagedImagePreview(image)
    expect(readImageAssetPreview).toHaveBeenCalledOnce()
    expect(readImageAssetPreview).toHaveBeenCalledWith(fileName)
    expect(image.getAttribute("src")).toBe("data:image/png;base64,aGVsbG8=")

    await recoverManagedImagePreview(image)
    expect(readImageAssetPreview).toHaveBeenCalledOnce()
  })

  it("does not request arbitrary files or retry a failed preview", async () => {
    const image = document.createElement("img")
    image.src = "file:///private/student-photo.png"
    document.body.append(image)
    const readImageAssetPreview = vi.fn()
    vi.stubGlobal("sztuDesktop", { readImageAssetPreview })
    await recoverManagedImagePreview(image)
    expect(readImageAssetPreview).not.toHaveBeenCalled()

    image.src = `sztu-asset://asset/${"b".repeat(64)}.png`
    readImageAssetPreview.mockRejectedValue(new Error("missing"))
    await recoverManagedImagePreview(image)
    await recoverManagedImagePreview(image)
    expect(readImageAssetPreview).toHaveBeenCalledOnce()
    expect(image.title).toBe("图片预览加载失败，请重新导入。")
  })
})
