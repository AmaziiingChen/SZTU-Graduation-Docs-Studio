import { existsSync } from "node:fs"
import path from "node:path"

/** Private fonts serve renderers directly; they need not be registered in the OS. */
export function documentFontDirectories(backendRoot: string, configured = process.env.SZTU_FONT_DIR): string | undefined {
  const roots = configured?.split(path.delimiter).filter(Boolean) ?? []
  for (const folder of ["document-fonts", "local-fonts"]) {
    const candidate = path.resolve(backendRoot, "..", folder)
    if (existsSync(candidate)) roots.push(candidate)
  }
  return roots.length ? [...new Set(roots)].join(path.delimiter) : undefined
}
