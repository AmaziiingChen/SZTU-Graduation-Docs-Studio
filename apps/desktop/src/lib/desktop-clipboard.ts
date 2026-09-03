import type { SztuDesktopApi } from "@/types/desktop-api"

function desktopApi(): SztuDesktopApi | undefined {
  return (window as Window & { sztuDesktop?: SztuDesktopApi }).sztuDesktop
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result)
      else reject(new Error("Clipboard image could not be encoded"))
    })
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Clipboard image could not be encoded")))
    reader.readAsDataURL(blob)
  })
}

export async function writeClipboardText(text: string): Promise<void> {
  const desktop = desktopApi()
  if (desktop?.writeClipboardText) {
    await desktop.writeClipboardText(text)
    return
  }
  if (!navigator.clipboard?.writeText) throw new Error("Text clipboard is unavailable")
  await navigator.clipboard.writeText(text)
}

export async function writeClipboardPng(blob: Blob): Promise<void> {
  const desktop = desktopApi()
  if (desktop?.writeClipboardPng) {
    await desktop.writeClipboardPng(await blobToDataUrl(blob))
    return
  }
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("Image clipboard is unavailable")
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
}
