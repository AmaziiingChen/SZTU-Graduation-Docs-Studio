import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, it } from "vitest"

import { privatePreviewRoot } from "./preview-path.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

it("uses the sidecar's canonical cache path when userData is reached through an alias", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sztu-preview-path-"))
  temporaryDirectories.push(directory)
  const actualUserData = path.join(directory, "actual")
  const aliasUserData = path.join(directory, "alias")
  await mkdir(actualUserData)
  await symlink(actualUserData, aliasUserData, process.platform === "win32" ? "junction" : "dir")

  expect(await privatePreviewRoot(aliasUserData, "document-id", "preview-id")).toBe(
    path.join(await realpath(actualUserData), "previews", "document-id", "preview-id"),
  )
})
