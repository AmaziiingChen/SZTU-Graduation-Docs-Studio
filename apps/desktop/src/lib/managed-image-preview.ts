import type { SztuDesktopApi } from "@/types/desktop-api"

const MANAGED_PREVIEW_URL = /^sztu-asset:\/\/asset\/([a-f0-9]{64}\.(?:png|jpe?g))$/

/** Recover a view-only preview if Chromium rejects the private asset scheme. */
export async function recoverManagedImagePreview(image: HTMLImageElement): Promise<void> {
  const url = image.getAttribute("src") ?? ""
  const fileName = MANAGED_PREVIEW_URL.exec(url)?.[1]
  if (!fileName || image.dataset.previewRecoveryAttempted === "true") return
  image.dataset.previewRecoveryAttempted = "true"

  const api = (window as Window & { sztuDesktop?: SztuDesktopApi }).sztuDesktop
  if (!api?.readImageAssetPreview) return
  try {
    const dataUrl = await api.readImageAssetPreview(fileName)
    if (image.isConnected && image.getAttribute("src") === url) image.src = dataUrl
  } catch {
    image.title = "图片预览加载失败，请重新导入。"
  }
}
