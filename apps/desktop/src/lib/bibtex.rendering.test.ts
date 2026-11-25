import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { formatBibtex } from "@/lib/bibtex"

// Hold the desktop preview to the text the compiled PDF produces. The golden
// file is generated from the repository GB/T 7714—2025 style by
// scripts/generate_bibtex_rendering_golden.mjs; both sides are normalized with
// the same rules below, so only wording, field order and punctuation are
// compared (not letter case, spacing or full-width/half-width forms).
const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../tests/fixtures")
const source = readFileSync(path.join(fixtures, "bibtex-rendering.bib"), "utf8")
const golden = JSON.parse(readFileSync(path.join(fixtures, "bibtex-rendering.golden.json"), "utf8")) as {
  entries: Record<string, string>
}

function normalizeReference(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/^\[\d+\]\s*/, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([,.;:/()[\]])\s*/g, "$1")
    .trim()
    .toLowerCase()
}

describe("GB/T 7714—2025 rendering", () => {
  const formatted = formatBibtex(source)

  it("renders every fixture entry without parser issues", () => {
    expect(formatted.issues).toEqual([])
    expect(formatted.references.map((reference) => reference.citationKey).sort()).toEqual(
      Object.keys(golden.entries).sort(),
    )
  })

  it.each(Object.keys(golden.entries))("matches the compiled style for %s", (citationKey) => {
    const reference = formatted.references.find((item) => item.citationKey === citationKey)
    expect(reference, `missing rendered entry ${citationKey}`).toBeDefined()
    expect(normalizeReference(reference?.text ?? "")).toBe(normalizeReference(golden.entries[citationKey]))
  })
})
