#!/usr/bin/env node

import { generateKeyPairSync } from "node:crypto"
import { chmod, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

export async function generateSigningKeyPair(outputDirectory) {
  const directory = path.resolve(outputDirectory)
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  const privateKeyPath = path.join(directory, "update-private.pem")
  const publicKeyPath = path.join(directory, "update-public.pem")
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await writeFile(
    privateKeyPath,
    privateKey.export({ type: "pkcs8", format: "pem" }),
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  )
  await writeFile(
    publicKeyPath,
    publicKey.export({ type: "spki", format: "pem" }),
    { encoding: "utf8", mode: 0o644, flag: "wx" },
  )
  await chmod(privateKeyPath, 0o600)
  return { privateKeyPath, publicKeyPath }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2 || argv[0] !== "--output-directory") {
    throw new Error("用法：--output-directory <仓库外的安全目录>")
  }
  const result = await generateSigningKeyPair(argv[1])
  process.stdout.write(
    `已生成免费 Ed25519 发布密钥。\n私钥（严禁提交或复制给客户端）：${result.privateKeyPath}\n公钥：${result.publicKeyPath}\n`,
  )
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "生成失败"}\n`)
    process.exitCode = 1
  })
}
