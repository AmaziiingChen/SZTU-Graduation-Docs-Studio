import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  createReleaseManifest,
  getReleaseStatus,
  initializeReleaseKeys,
} from "./release-management.ts"

describe("local signed release management", () => {
  it("keeps the private key server-side and creates a signed schema 2.0 manifest", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sztu-release-admin-"))
    const artifactPath = path.join(directory, "fictional.dmg")
    await writeFile(artifactPath, "fictional installer")
    const environment = { SZTU_RELEASE_DIRECTORY: path.join(directory, "release") }
    const repositoryRoot = path.resolve(import.meta.dirname, "../../..")

    const initialized = await initializeReleaseKeys(environment, repositoryRoot)
    expect(initialized.keyReady).toBe(true)
    expect(initialized.publicKeyPem).toContain("BEGIN PUBLIC KEY")
    expect(initialized.publicKeyPem).not.toContain("PRIVATE KEY")

    const result = await createReleaseManifest({
      version: "0.2.0",
      artifacts: [{
        platform: "darwin",
        arch: "arm64",
        filePath: artifactPath,
        url: "https://downloads.example.test/fictional.dmg",
      }],
      control: {
        update_policy: "recommended",
        minimum_supported_version: "0.1.0",
        service_status: "normal",
        help_url: "https://docs.example.test/guide",
        announcement: null,
      },
    }, environment, repositoryRoot)

    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as {
      payload: { schema_version: string; control: { update_policy: string } }
      signature: string
    }
    expect(manifest.payload.schema_version).toBe("2.0")
    expect(manifest.payload.control.update_policy).toBe("recommended")
    expect(manifest.signature).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    expect((await getReleaseStatus(environment)).manifestReady).toBe(true)
  })

  it("creates a control-only manifest without an installer", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sztu-control-only-admin-"))
    const environment = { SZTU_RELEASE_DIRECTORY: path.join(directory, "release") }
    const repositoryRoot = path.resolve(import.meta.dirname, "../../..")
    await initializeReleaseKeys(environment, repositoryRoot)

    const result = await createReleaseManifest({
      version: "0.1.0",
      artifacts: [],
      control: {
        update_policy: "optional",
        minimum_supported_version: null,
        service_status: "normal",
        help_url: null,
        announcement: null,
      },
    }, environment, repositoryRoot)

    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as {
      payload: { schema_version: string; artifacts: unknown[] }
    }
    expect(manifest.payload.schema_version).toBe("2.0")
    expect(manifest.payload.artifacts).toEqual([])
  })
})
