import { useState } from "react"
import { useTheme } from "next-themes"
import { CheckIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  appearancePresets,
  applyAppearancePreset,
  getStoredAppearancePreset,
  type AppearancePalette,
  type AppearancePreset,
} from "@/lib/appearance-themes"
import { cn } from "@/lib/utils"

const baseThemes = [
  { value: "system", label: "跟随系统", icon: MonitorIcon },
  { value: "light", label: "浅色", icon: SunIcon },
  { value: "dark", label: "深色", icon: MoonIcon },
] as const

function PalettePreview({ palette }: { palette: AppearancePalette }) {
  return (
    <span
      className="grid h-16 grid-cols-[1.35rem_1fr] gap-2 p-2"
      style={{ backgroundColor: palette.background, color: palette.foreground }}
      aria-hidden="true"
    >
      <span className="rounded-sm" style={{ backgroundColor: palette.accent }} />
      <span className="grid gap-2">
        <span className="rounded-sm" style={{ backgroundColor: palette.foreground + "18" }} />
        <span className="h-2 w-2/3 rounded-full" style={{ backgroundColor: palette.foreground + "40" }} />
      </span>
    </span>
  )
}

function PresetCard({ preset, selected, onSelect }: {
  preset: AppearancePreset
  selected: boolean
  onSelect: () => void
}) {
  return (
    <Button
      type="button"
      variant="outline"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "h-auto min-h-32 items-stretch justify-start p-3 text-left whitespace-normal",
        selected && "border-ring ring-3 ring-ring/20",
      )}
    >
      <span className="grid w-full gap-3">
        <span className="grid grid-cols-2 overflow-hidden rounded-md border">
          <PalettePreview palette={preset.light} />
          <PalettePreview palette={preset.dark} />
        </span>
        <span className="flex items-center gap-2">
          <span className="font-medium">{preset.label}</span>
          {selected ? <CheckIcon className="ml-auto size-4" aria-hidden="true" /> : null}
        </span>
      </span>
    </Button>
  )
}

export function AppearanceSettings() {
  const { theme = "system", setTheme } = useTheme()
  const [selectedPresetId, setSelectedPresetId] = useState(
    () => getStoredAppearancePreset().id,
  )

  const selectPreset = (preset: AppearancePreset) => {
    applyAppearancePreset(preset)
    setSelectedPresetId(preset.id)
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto grid w-full max-w-5xl gap-6 p-6">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">选择工作台外观</h2>
          <p className="text-sm text-muted-foreground">
            先选择浅色、深色或跟随系统，再选择一套配套主题。外观不会影响文档内容和导出样式。
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">基础外观</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-3">
            {baseThemes.map((option) => {
              const selected = theme === option.value
              const Icon = option.icon
              return (
                <Button
                  key={option.value}
                  type="button"
                  variant="outline"
                  aria-pressed={selected}
                  onClick={() => setTheme(option.value)}
                  className={cn("justify-start", selected && "border-ring ring-3 ring-ring/20")}
                >
                  <Icon className="size-4 text-muted-foreground" />
                  {option.label}
                  {selected ? <CheckIcon className="ml-auto size-4" aria-hidden="true" /> : null}
                </Button>
              )
            })}
          </CardContent>
        </Card>

        <section className="grid gap-3" aria-labelledby="appearance-presets">
          <div className="flex items-center gap-2">
            <h3 id="appearance-presets" className="text-sm font-medium">主题</h3>
            <span className="text-xs text-muted-foreground">{appearancePresets.length} 款</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {appearancePresets.map((preset) => (
              <PresetCard
                key={preset.id}
                preset={preset}
                selected={selectedPresetId === preset.id}
                onSelect={() => selectPreset(preset)}
              />
            ))}
          </div>
        </section>
      </div>
    </ScrollArea>
  )
}
