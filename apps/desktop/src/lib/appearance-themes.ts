export const APPEARANCE_PRESET_STORAGE_KEY = "sztu-workbench-appearance-preset"

export type AppearancePalette = {
  accent: string
  background: string
  foreground: string
}

export type AppearancePreset = {
  id: string
  label: string
  light: AppearancePalette
  dark: AppearancePalette
}

export const appearancePresets: AppearancePreset[] = [
  {
    id: "shadcn",
    label: "shadcn",
    light: { accent: "#343434", background: "#FFFFFF", foreground: "#252525" },
    dark: { accent: "#EBEBEB", background: "#252525", foreground: "#FAFAFA" },
  },
  {
    id: "notion",
    label: "Notion",
    light: { accent: "#3183D8", background: "#FFFFFF", foreground: "#37352F" },
    dark: { accent: "#3183D8", background: "#191919", foreground: "#D9D9D8" },
  },
  {
    id: "absolutely",
    label: "Absolutely",
    light: { accent: "#CC7D5E", background: "#F9F9F7", foreground: "#2D2D2B" },
    dark: { accent: "#CC7D5E", background: "#2D2D2B", foreground: "#F9F9F7" },
  },
  {
    id: "github",
    label: "GitHub",
    light: { accent: "#0969DA", background: "#FFFFFF", foreground: "#1F2328" },
    dark: { accent: "#1F6FEB", background: "#0D1117", foreground: "#E6EDF3" },
  },
  {
    id: "everforest",
    label: "Everforest",
    light: { accent: "#93B259", background: "#FDF6E3", foreground: "#5C6A72" },
    dark: { accent: "#A7C080", background: "#2D353B", foreground: "#D3C6AA" },
  },
  {
    id: "linear",
    label: "Linear",
    light: { accent: "#5E6AD2", background: "#FCFCFD", foreground: "#1B1B1B" },
    dark: { accent: "#606ACC", background: "#0F0F11", foreground: "#E3E4E6" },
  },
]

export const defaultAppearancePreset = appearancePresets.find(
  (preset) => preset.id === "notion",
)!

export function getStoredAppearancePreset() {
  if (typeof window === "undefined") return defaultAppearancePreset
  const presetId = window.localStorage.getItem(APPEARANCE_PRESET_STORAGE_KEY)
  return (
    appearancePresets.find((preset) => preset.id === presetId) ??
    defaultAppearancePreset
  )
}

export function applyAppearancePreset(preset: AppearancePreset) {
  if (typeof document === "undefined") return
  document.documentElement.dataset.themePreset = preset.id
  window.localStorage.setItem(APPEARANCE_PRESET_STORAGE_KEY, preset.id)
}
