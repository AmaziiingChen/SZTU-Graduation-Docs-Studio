import { useEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { useTheme } from "next-themes"
import { CheckIcon } from "lucide-react"
import { AirplayIcon } from "@/components/ui/airplay"
import { MoonIcon } from "@/components/ui/moon"
import { SunIcon } from "@/components/ui/sun"
import { AnimatedActionIcon } from "@/components/animated-action-icon"


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
  { value: "system", label: "跟随系统", icon: AirplayIcon },
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
  const transitionRef = useRef<ViewTransition | null>(null)
  const animationRef = useRef<Animation | null>(null)
  const themeRequestRef = useRef(0)
  const requestedThemeRef = useRef<(typeof baseThemes)[number]["value"] | null>(null)

  useEffect(() => () => {
    themeRequestRef.current += 1
    transitionRef.current?.skipTransition()
    animationRef.current?.cancel()
    document.documentElement.removeAttribute("data-theme-transition")
  }, [])

  const selectTheme = async (nextTheme: (typeof baseThemes)[number]["value"]) => {
    const root = document.documentElement
    const request = ++themeRequestRef.current
    requestedThemeRef.current = nextTheme
    transitionRef.current?.skipTransition()
    animationRef.current?.cancel()
    transitionRef.current = null
    animationRef.current = null
    const nextDark = nextTheme === "dark" || (nextTheme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
    if (root.classList.contains("dark") === nextDark || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !document.startViewTransition) {
      root.removeAttribute("data-theme-transition")
      setTheme(nextTheme)
      return
    }

    // Animate UI ThemeToggler's directional wipe, applied to our existing buttons.
    // Commit through next-themes inside the snapshot update so storage, resolved
    // mode and the root class agree even if the visual transition is interrupted.
    root.setAttribute("data-theme-transition", "true")
    try {
      const transition = document.startViewTransition(() => {
        // A skipped transition still invokes its update callback. Always apply
        // the latest request, including when navigation unmounts this settings page.
        flushSync(() => setTheme(requestedThemeRef.current ?? nextTheme))
      })
      transitionRef.current = transition
      await transition.ready
      if (themeRequestRef.current !== request) return
      const animation = root.animate(
        { clipPath: ["inset(0 100% 0 0)", "inset(0 0 0 0)"] },
        { duration: 700, easing: "ease-in-out", pseudoElement: "::view-transition-new(root)" },
      )
      animationRef.current = animation
      await animation.finished
      await transition.finished
    } catch {
      // Snapshot/animation support can fail (for example in a hidden window).
      // The theme choice still takes effect; only the decorative wipe is skipped.
      if (themeRequestRef.current === request) {
        transitionRef.current?.skipTransition()
        setTheme(nextTheme)
      }
    } finally {
      if (themeRequestRef.current === request) {
        root.removeAttribute("data-theme-transition")
        transitionRef.current = null
        animationRef.current = null
      }
    }
  }

  const selectPreset = (preset: AppearancePreset) => {
    applyAppearancePreset(preset)
    setSelectedPresetId(preset.id)
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto grid w-full max-w-5xl gap-6 p-6">
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
                  onClick={() => void selectTheme(option.value)}
                  className={cn("justify-start", selected && "border-ring ring-3 ring-ring/20")}
                >
                  <AnimatedActionIcon icon={Icon} className="text-muted-foreground" />
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
