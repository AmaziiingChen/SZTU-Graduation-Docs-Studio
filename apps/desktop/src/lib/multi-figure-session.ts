export type SessionFigureItem = {
  id: string
  file: File
  previewUrl: string
  caption: string
}

let sessionImages: SessionFigureItem[] = []

export function getMultiFigureSessionImages(): SessionFigureItem[] {
  return sessionImages
}

export function setMultiFigureSessionImages(images: SessionFigureItem[]): void {
  sessionImages = images
}

export function clearMultiFigureSessionImages(): SessionFigureItem[] {
  const previous = sessionImages
  sessionImages = []
  return previous
}
