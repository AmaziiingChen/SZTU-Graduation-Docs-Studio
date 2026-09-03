import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "next-themes"

import { TooltipProvider } from "@/components/ui/tooltip"

import "./index.css"
import App from "./App.tsx"
import { applyAppearancePreset, getStoredAppearancePreset } from "@/lib/appearance-themes"

applyAppearancePreset(getStoredAppearancePreset())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
)
