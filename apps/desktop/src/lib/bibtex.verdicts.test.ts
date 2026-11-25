import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"

import { parseBibtex } from "@/lib/bibtex"

interface VerdictCase {
  id: string
  valid: boolean
  entries?: number
  source: string
}

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../tests/fixtures/bibtex-verdicts.json",
)
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { cases: VerdictCase[] }

it.each(fixture.cases)("agrees with the export gate on $id", ({ valid, entries, source }) => {
  const result = parseBibtex(source)
  expect(result.issues.length === 0).toBe(valid)
  if (valid && entries !== undefined) expect(result.entries).toHaveLength(entries)
})
