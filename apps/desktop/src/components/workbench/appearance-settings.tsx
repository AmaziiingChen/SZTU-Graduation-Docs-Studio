import { useTheme } from "next-themes"
import {
  CheckIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

type ThemeOption = {
  value: "system" | "light" | "dark"
  label: string
  description: string
  icon: LucideIcon
}

const themeOptions: ThemeOption[] = [
  {
    value: "system",
    label: "跟随系统",
    description: "随 macOS 或 Windows 的外观设置自动切换。",
    icon: MonitorIcon,
  },
  {
    value: "light",
    label: "浅色",
    description: "保持清晰明亮，适合白天和光线充足的环境。",
    icon: SunIcon,
  },
  {
    value: "dark",
    label: "深色",
    description: "降低大面积亮度，适合夜间或弱光环境。",
    icon: MoonIcon,
  },
]

function ThemePreview({ theme }: { theme: ThemeOption["value"] }) {
  if (theme === "system") {
    return (
      <div
        className="grid h-20 grid-cols-2 overflow-hidden rounded-lg border"
        aria-hidden="true"
      >
        <div className="grid bg-background p-2 dark:bg-foreground">
          <div className="rounded-sm bg-muted dark:bg-background/10" />
          <div className="mt-2 h-2 w-3/4 rounded-full bg-muted-foreground/30 dark:bg-background/30" />
        </div>
        <div className="grid bg-foreground p-2 dark:bg-background">
          <div className="rounded-sm bg-background/15 dark:bg-foreground/15" />
          <div className="mt-2 h-2 w-3/4 rounded-full bg-background/30 dark:bg-foreground/30" />
        </div>
      </div>
    )
  }

  const isDark = theme === "dark"
  return (
    <div
      className={cn(
        "grid h-20 grid-cols-[1.6rem_1fr] gap-2 rounded-lg border p-2",
        isDark
          ? "border-foreground/20 bg-foreground dark:bg-background"
          : "bg-background dark:bg-foreground",
      )}
      aria-hidden="true"
    >
      <div
        className={cn(
          "rounded-sm",
          isDark
            ? "bg-background/15 dark:bg-foreground/15"
            : "bg-muted dark:bg-background/10",
        )}
      />
      <div className="grid gap-2">
        <div
          className={cn(
            "rounded-sm",
            isDark
              ? "bg-background/15 dark:bg-foreground/15"
              : "bg-muted dark:bg-background/10",
          )}
        />
        <div
          className={cn(
            "h-2 w-3/4 rounded-full",
            isDark
              ? "bg-background/30 dark:bg-foreground/30"
              : "bg-muted-foreground/30 dark:bg-background/30",
          )}
        />
      </div>
    </div>
  )
}

export function AppearanceSettings() {
  const { theme = "system", setTheme } = useTheme()

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto grid w-full max-w-4xl gap-6 p-6">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">选择工作台外观</h2>
          <p className="text-sm text-muted-foreground">
            外观会立即应用，并保存在当前设备上。
          </p>
        </div>

        <div
          className="grid gap-3 sm:grid-cols-3"
          role="group"
          aria-label="工作台外观"
        >
          {themeOptions.map((option) => {
            const selected = theme === option.value
            const Icon = option.icon

            return (
              <Button
                key={option.value}
                type="button"
                variant="outline"
                aria-pressed={selected}
                onClick={() => setTheme(option.value)}
                className={cn(
                  "h-auto min-h-44 flex-col items-stretch justify-start gap-3 p-3 text-left whitespace-normal",
                  selected && "border-ring ring-3 ring-ring/20",
                )}
              >
                <ThemePreview theme={option.value} />
                <span className="flex items-center gap-2">
                  <Icon className="size-4 text-muted-foreground" />
                  <span className="font-medium">{option.label}</span>
                  {selected ? <CheckIcon className="ml-auto size-4" aria-hidden="true" /> : null}
                </span>
                <span className="text-xs leading-relaxed font-normal text-muted-foreground">
                  {option.description}
                </span>
              </Button>
            )
          })}
        </div>
      </div>
    </ScrollArea>
  )
}
