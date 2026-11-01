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
  await mkdir(path.join(actualUserData, "previews", "document-id", "preview-id"), { recursive: true })
  await symlink(actualUserData, aliasUserData, process.platform === "win32" ? "junction" : "dir")

  expect(await privatePreviewRoot(aliasUserData, "document-id", "preview-id")).toBe(
    path.join(await realpath(actualUserData), "previews", "document-id", "preview-id"),
  )
})

it("resolves a redirected preview child even when userData itself is not an alias", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sztu-preview-child-"))
  temporaryDirectories.push(directory)
  const userData = path.join(directory, "Roaming", "workbench")
  const redirected = path.join(directory, "LocalCache", "previews")
  await mkdir(userData, { recursive: true })
  await mkdir(path.join(redirected, "document-id", "preview-id"), { recursive: true })
  await symlink(redirected, path.join(userData, "previews"), process.platform === "win32" ? "junction" : "dir")

  expect(await privatePreviewRoot(userData, "document-id", "preview-id")).toBe(
    path.join(await realpath(redirected), "document-id", "preview-id"),
  )
})

it("resolves a redirected document directory inside an ordinary previews directory", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sztu-preview-document-"))
  temporaryDirectories.push(directory)
  const userData = path.join(directory, "Roaming")
  const redirected = path.join(directory, "LocalCache", "document")
  await mkdir(path.join(userData, "previews"), { recursive: true })
  await mkdir(path.join(redirected, "preview-id"), { recursive: true })
  await symlink(redirected, path.join(userData, "previews", "document-id"), process.platform === "win32" ? "junction" : "dir")

  expect(await privatePreviewRoot(userData, "document-id", "preview-id")).toBe(
    path.join(await realpath(redirected), "preview-id"),
  )
})

it("rejects a missing preview directory instead of trusting an unverified path", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sztu-preview-missing-"))
  temporaryDirectories.push(directory)
  await expect(privatePreviewRoot(directory, "document-id", "missing")).rejects.toMatchObject({ code: "ENOENT" })
})
