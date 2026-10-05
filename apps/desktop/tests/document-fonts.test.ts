import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect, it } from "vitest"
import { documentFontDirectories } from "../electron/document-fonts"

it("uses explicit, shipped and development-private fonts without changing system paths", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "sztu-font-roots-"))
  try {
    const backend = path.join(root, "backend")
    expect(documentFontDirectories(backend, "")).toBeUndefined()
    const shipped = path.join(root, "document-fonts")
    const local = path.join(root, "local-fonts")
    mkdirSync(shipped); mkdirSync(local)
    expect(documentFontDirectories(backend, "")).toBe([shipped, local].join(path.delimiter))
    expect(documentFontDirectories(backend, shipped)).toBe([shipped, local].join(path.delimiter))
  } finally { rmSync(root, {recursive: true, force: true}) }
})
