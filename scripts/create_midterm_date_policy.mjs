#!/usr/bin/env node

import { createPrivateKey, sign } from "node:crypto"
import { chmod, readFile, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"

import { canonicalJson } from "./create_update_manifest.mjs"

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => key in value)
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const year = Number(value.slice(0, 4))
  if (year < 1900 || year > 2100) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function validateMidtermDateRules(value) {
  if (!Array.isArray(value) || value.length > 50) throw new Error("日期规则最多 50 条。")
  const colleges = new Set()
  return value.map((item) => {
    if (!exactKeys(item, ["college", "start_date", "end_date"]) ||
        typeof item.college !== "string" || item.college !== item.college.trim() ||
        item.college.length < 1 || item.college.length > 100 ||
        !validDate(item.start_date) || !validDate(item.end_date) ||
        item.start_date > item.end_date) {
      throw new Error("学院名称或日期范围无效。")
    }
    const college = item.college.normalize("NFC")
    if (colleges.has(college)) throw new Error("同一学院只能设置一条日期规则。")
    colleges.add(college)
    return { college, start_date: item.start_date, end_date: item.end_date }
  })
}

export function createSignedMidtermDatePolicy({ rules, privateKeyPem, publishedAt = new Date().toISOString() }) {
  if (!Number.isFinite(Date.parse(publishedAt))) throw new Error("发布时间无效。")
  const key = createPrivateKey(privateKeyPem)
  if (key.asymmetricKeyType !== "ed25519") throw new Error("必须使用 Ed25519 私钥。")
  const payload = {
    schema_version: "1.0",
    published_at: new Date(publishedAt).toISOString(),
    rules: validateMidtermDateRules(rules),
  }
  return {
    payload,
    signature: sign(null, Buffer.from(canonicalJson(payload), "utf8"), key).toString("base64"),
  }
}

async function main(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 2) {
    if (!["--rules", "--private-key", "--output"].includes(argv[index]) || !argv[index + 1]) {
      throw new Error("请提供 --rules、--private-key 和 --output。")
    }
    args[argv[index]] = argv[index + 1]
  }
  if (Object.keys(args).length !== 3) throw new Error("请提供 --rules、--private-key 和 --output。")
  const [rulesText, privateKeyPem] = await Promise.all([
    readFile(args["--rules"], "utf8"),
    readFile(args["--private-key"], "utf8"),
  ])
  const policy = createSignedMidtermDatePolicy({ rules: JSON.parse(rulesText), privateKeyPem })
  await writeFile(args["--output"], `${JSON.stringify(policy, null, 2)}\n`, { mode: 0o600 })
  await chmod(args["--output"], 0o600)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
