import { describe, expect, it } from "vitest"
import { developmentConfig } from "../../electron/development-config"

describe("isolated worktree development", () => {
  it("uses loopback and a separate absolute data path", () => {
    expect(developmentConfig(false, { SZTU_DOCS_DEV_PORT: "5174", SZTU_DOCS_DEV_DATA_DIR: "/tmp/thesis-dev" })).toEqual({ url: "http://127.0.0.1:5174", dataDirectory: "/tmp/thesis-dev" })
  })
  it("ignores overrides in packaged builds", () => {
    expect(developmentConfig(true, { SZTU_DOCS_DEV_PORT: "https://evil.invalid", SZTU_DOCS_DEV_DATA_DIR: "relative" })).toEqual({ url: "http://127.0.0.1:5173", dataDirectory: undefined })
  })
  it("rejects non-loopback injection and relative data directories", () => {
    for (const port of ["0", "80", "65536", "5174/path", "evil.invalid", ""]) {
      expect(() => developmentConfig(false, { SZTU_DOCS_DEV_PORT: port })).toThrow()
    }
    expect(() => developmentConfig(false, { SZTU_DOCS_DEV_DATA_DIR: "../original" })).toThrow()
  })
})
