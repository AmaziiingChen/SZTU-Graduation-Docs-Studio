import type { SztuDesktopApi } from "./desktop-api"

declare global {
  interface Window {
    sztuDesktop?: SztuDesktopApi
  }
}

export {}
