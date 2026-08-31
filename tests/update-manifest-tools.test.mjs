import assert from "node:assert/strict"
import { generateKeyPairSync, verify } from "node:crypto"
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import {
  canonicalJson,
  createSignedManifest,
} from "../scripts/create_update_manifest.mjs"

test("creates an Ed25519 manifest with exact size and SHA-256 metadata", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "sztu-update-manifest-"))
  const artifactPath = path.join(directory, "sztu-docs.dmg")
  const privateKeyPath = path.join(directory, "private.pem")
  await writeFile(artifactPath, Buffer.from("fictional update artifact"))
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  await writeFile(
    privateKeyPath,
    privateKey.export({ type: "pkcs8", format: "pem" }),
    { mode: 0o600 },
  )

  const manifest = await createSignedManifest({
    version: "0.2.0",
    publishedAt: "2026-08-31T00:00:00.000Z",
    privateKeyPath,
    artifacts: [
      {
        platform: "darwin",
        arch: "arm64",
        filePath: artifactPath,
        url: "https://downloads.example.com/sztu-docs.dmg",
      },
    ],
  })

  assert.equal(manifest.payload.version, "0.2.0")
  assert.equal(manifest.payload.artifacts[0].size_bytes, (await stat(artifactPath)).size)
  assert.equal(manifest.payload.artifacts[0].sha256.length, 64)
  assert.equal(
    verify(
      null,
      Buffer.from(canonicalJson(manifest.payload), "utf8"),
      publicKey,
      Buffer.from(manifest.signature, "base64"),
    ),
    true,
  )
  assert.doesNotMatch(await readFile(artifactPath, "utf8"), /PRIVATE KEY/)
})
