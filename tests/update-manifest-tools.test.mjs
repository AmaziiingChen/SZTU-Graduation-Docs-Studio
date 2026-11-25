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
import { generateSigningKeyPair } from "../scripts/generate_update_signing_key.mjs"
import { createSignedMidtermDatePolicy, validateMidtermDateRules } from "../scripts/create_midterm_date_policy.mjs"

test("signs strict college date rules independently of the update manifest", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "sztu-date-policy-"))
  const keys = await generateSigningKeyPair(path.join(directory, "keys"))
  const policy = createSignedMidtermDatePolicy({
    privateKeyPem: await readFile(keys.privateKeyPath, "utf8"),
    publishedAt: "2026-09-24T00:00:00.000Z",
    rules: [{ college: "新材料与新能源学院", start_date: "2026-09-20", end_date: "2026-09-30" }],
  })
  assert.equal(policy.payload.rules.length, 1)
  assert.equal(verify(null, Buffer.from(canonicalJson(policy.payload)),
    await readFile(keys.publicKeyPath, "utf8"), Buffer.from(policy.signature, "base64")), true)
  assert.throws(() => validateMidtermDateRules([
    { college: "学院", start_date: "2026-09-31", end_date: "2026-10-01" },
  ]), /无效/)
  assert.throws(() => validateMidtermDateRules([
    { college: "学院", start_date: "2026-10-01", end_date: "2026-09-30" },
  ]), /无效/)
})

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

test("creates a schema 2.0 manifest with signed release control", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "sztu-release-control-"))
  const artifactPath = path.join(directory, "sztu-docs.exe")
  await writeFile(artifactPath, Buffer.from("fictional windows installer"))
  const keys = await generateSigningKeyPair(path.join(directory, "keys"))
  const manifest = await createSignedManifest({
    version: "0.3.0",
    publishedAt: "2026-09-04T00:00:00.000Z",
    privateKeyPath: keys.privateKeyPath,
    artifacts: [{
      platform: "win32",
      arch: "x64",
      filePath: artifactPath,
      url: "https://downloads.example.com/sztu-docs-0.3.0.exe",
    }],
    control: {
      update_policy: "required",
      minimum_supported_version: "0.2.0",
      service_status: "normal",
      help_url: "https://docs.example.com/guide",
      announcement: {
        id: "release-030",
        title: "版本更新",
        body: "请更新到新版本。",
        severity: "important",
        starts_at: "2026-09-04T00:00:00.000Z",
        ends_at: null,
        dismissible: true,
      },
    },
  })
  const publicKey = await readFile(keys.publicKeyPath, "utf8")
  assert.equal(manifest.payload.schema_version, "2.0")
  assert.equal(manifest.payload.control.update_policy, "required")
  assert.equal(
    verify(
      null,
      Buffer.from(canonicalJson(manifest.payload), "utf8"),
      publicKey,
      Buffer.from(manifest.signature, "base64"),
    ),
    true,
  )
  assert.match(await readFile(keys.privateKeyPath, "utf8"), /PRIVATE KEY/)
  assert.doesNotMatch(publicKey, /PRIVATE KEY/)
})

test("creates a signed schema 3.0 manifest with release notices", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "sztu-notices-"))
  const keys = await generateSigningKeyPair(path.join(directory, "keys"))
  const manifest = await createSignedManifest({
    version: "0.2.0",
    publishedAt: "2026-11-26T00:00:00.000Z",
    privateKeyPath: keys.privateKeyPath,
    artifacts: [],
    schemaVersion: "3.0",
    control: {
      update_policy: "optional",
      minimum_supported_version: null,
      service_status: "normal",
      help_url: "https://example.com/guide",
      announcement: null,
      notices: [
        {
          id: "notice-maintenance",
          title: "周末维护提醒",
          body: "本周六晚八点进行服务维护。",
          image_url: null,
          severity: "important",
          starts_at: "2026-11-26T00:00:00.000Z",
          ends_at: null,
          min_version: "0.2.0",
          max_version: null,
          actions: [
            { id: "open-help", label: "查看说明", kind: "internal", target: "faq" },
          ],
        },
      ],
    },
  })
  const publicKey = await readFile(keys.publicKeyPath, "utf8")
  assert.equal(manifest.payload.schema_version, "3.0")
  assert.equal(manifest.payload.control.notices.length, 1)
  assert.equal(
    verify(
      null,
      Buffer.from(canonicalJson(manifest.payload), "utf8"),
      publicKey,
      Buffer.from(manifest.signature, "base64"),
    ),
    true,
  )
})

test("rejects notices with unknown internal targets or unsafe image urls", async () => {
  const { validateNotice } = await import("../scripts/create_update_manifest.mjs")
  const base = {
    id: "notice-1",
    title: "标题",
    body: "正文内容。",
    image_url: null,
    severity: "info",
    starts_at: "2026-11-26T00:00:00.000Z",
    ends_at: null,
    min_version: null,
    max_version: null,
    actions: [],
  }
  assert.doesNotThrow(() => validateNotice(base))
  assert.throws(
    () => validateNotice({ ...base, actions: [{ id: "a", label: "打开", kind: "internal", target: "download" }] }),
    /目标不受支持/,
  )
  assert.throws(
    () => validateNotice({ ...base, image_url: "http://example.com/a.png" }),
    /HTTPS/,
  )
})

test("creates a signed control-only manifest without an installer", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "sztu-control-only-"))
  const keys = await generateSigningKeyPair(path.join(directory, "keys"))
  const manifest = await createSignedManifest({
    version: "0.1.0",
    publishedAt: "2026-09-04T00:00:00.000Z",
    privateKeyPath: keys.privateKeyPath,
    artifacts: [],
    control: {
      update_policy: "optional",
      minimum_supported_version: null,
      service_status: "normal",
      help_url: null,
      announcement: {
        id: "welcome",
        title: "使用提示",
        body: "请先阅读最新使用说明。",
        severity: "info",
        starts_at: "2026-09-04T00:00:00.000Z",
        ends_at: null,
        dismissible: true,
      },
    },
  })
  assert.equal(manifest.payload.schema_version, "2.0")
  assert.deepEqual(manifest.payload.artifacts, [])
  assert.equal(manifest.payload.control.announcement.id, "welcome")
})
