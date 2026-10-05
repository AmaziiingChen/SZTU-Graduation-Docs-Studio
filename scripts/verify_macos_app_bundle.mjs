#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { verifyThesisTemplateResource } from "./verify_thesis_template_resource.mjs"

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)
const appRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(
      repositoryRoot,
      "release",
      "mac-arm64",
      "SZTU文档工作台.app",
    )
const contentsRoot = path.join(appRoot, "Contents")
const resourcesRoot = path.join(contentsRoot, "Resources")
const frameworkResourcesRoot = path.join(
  contentsRoot,
  "Frameworks",
  "Electron Framework.framework",
  "Versions",
  "A",
  "Resources",
)
const allowedLocales = new Set(["en", "zh_CN"])
const maximumAsarBytes = 16 * 1024 * 1024
const forbiddenFontExtensions = new Set([".otf", ".ttc", ".ttf"])
const requiredEngineNames = ["midterm", "proposal", "task_book", "advisor_review", "reviewer_review", "defense_record", "grade_assessment"]
const publicReleaseRedistribution = "public-release-authorized"
const releaseDocxMetadataPolicy = "public-release-scrubbed-v1"
const failures = []

const signatureCheck = spawnSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", appRoot], {
  encoding: "utf8",
})
if (signatureCheck.status !== 0) {
  failures.push(`app bundle code signature is invalid: ${signatureCheck.stderr.trim()}`)
}

function sha256File(target) {
  return createHash("sha256").update(readFileSync(target)).digest("hex")
}

function unzip(target, args) {
  const result = spawnSync("/usr/bin/unzip", [...args, target], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new Error(result.stderr || "unzip failed")
  }
  return result.stdout
}

function unzipEntry(target, entry) {
  const result = spawnSync("/usr/bin/unzip", ["-p", target, entry], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new Error(result.stderr || `cannot read ${entry}`)
  }
  return result.stdout
}

function containsXmlElement(xml, localName) {
  const escaped = localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${escaped}\\b`).test(xml)
}

function verifyReleaseDocxMetadata(target, label) {
  try {
    const members = unzip(target, ["-Z1"]).split(/\r?\n/).filter(Boolean)
    if (members.includes("docProps/custom.xml")) {
      failures.push(`${label} still contains custom document properties`)
    }
    const core = unzipEntry(target, "docProps/core.xml")
    for (const localName of [
      "creator",
      "lastModifiedBy",
      "lastPrinted",
      "created",
      "modified",
    ]) {
      if (containsXmlElement(core, localName)) {
        failures.push(`${label} still contains ${localName}`)
      }
    }
    const app = unzipEntry(target, "docProps/app.xml")
    for (const localName of [
      "Application",
      "AppVersion",
      "Company",
      "HyperlinkBase",
      "Manager",
      "Template",
      "TotalTime",
    ]) {
      if (containsXmlElement(app, localName)) {
        failures.push(`${label} still contains ${localName}`)
      }
    }
    for (const member of members.filter((name) =>
      /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes|settings)\.xml$/.test(name),
    )) {
      const xml = unzipEntry(target, member)
      if (/\s[A-Za-z_][\w.-]*:rsid[\w.-]*\s*=/.test(xml)) {
        failures.push(`${label} still contains revision session attributes in ${member}`)
      }
      if (/<[A-Za-z_][\w.-]*:rsids?\b/.test(xml) || /<[A-Za-z_][\w.-]*:rsidRoot\b/.test(xml)) {
        failures.push(`${label} still contains revision session elements in ${member}`)
      }
    }
  } catch (error) {
    failures.push(`${label} metadata could not be inspected: ${error.message}`)
  }
}

function requireFile(target, label) {
  if (!existsSync(target) || !statSync(target).isFile()) {
    failures.push(`${label} is missing`)
  }
}

function requireDirectory(target, label) {
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    failures.push(`${label} is missing`)
  }
}

function localeNames(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".lproj"))
    .map((entry) => entry.name.slice(0, -".lproj".length))
    .sort()
}

function verifyLocales(directory, label) {
  const locales = localeNames(directory)
  const unexpected = locales.filter((locale) => !allowedLocales.has(locale))
  const missing = [...allowedLocales].filter((locale) => !locales.includes(locale))
  if (unexpected.length > 0) {
    failures.push(`${label} contains unexpected locales: ${unexpected.join(", ")}`)
  }
  if (missing.length > 0) {
    failures.push(`${label} is missing locales: ${missing.join(", ")}`)
  }
  return locales
}

function collectForbiddenFonts(directory, result = []) {
  if (!existsSync(directory)) return result
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      collectForbiddenFonts(target, result)
    } else if (forbiddenFontExtensions.has(path.extname(entry.name).toLowerCase())) {
      result.push(path.relative(appRoot, target))
    }
  }
  return result
}

requireDirectory(appRoot, "packaged application")
const asarPath = path.join(resourcesRoot, "app.asar")
requireFile(asarPath, "application archive")
requireFile(
  path.join(resourcesRoot, "sidecar", "sztu-docs-backend"),
  "backend sidecar",
)
requireFile(
  path.join(resourcesRoot, "bundled-template-engines", "bundle-manifest.json"),
  "template engine bundle manifest",
)

const asarBytes = existsSync(asarPath) ? statSync(asarPath).size : 0
if (existsSync(asarPath)) {
  try { verifyThesisTemplateResource(asarPath) }
  catch (error) { failures.push(`thesis download resource: ${error.message}`) }
}
if (asarBytes > maximumAsarBytes) {
  failures.push(
    `application archive is unexpectedly large: ${asarBytes} bytes (limit ${maximumAsarBytes})`,
  )
}
if (existsSync(path.join(resourcesRoot, "app.asar.unpacked", "node_modules"))) {
  failures.push("runtime node_modules leaked into app.asar.unpacked")
}

const appLocales = verifyLocales(resourcesRoot, "application resources")
const frameworkLocales = verifyLocales(
  frameworkResourcesRoot,
  "Electron framework resources",
)
const bundledFonts = collectForbiddenFonts(
  path.join(resourcesRoot, "bundled-template-engines"),
)
if (bundledFonts.length > 0) {
  failures.push(`document fonts entered the bundle: ${bundledFonts.join(", ")}`)
}

const manifestPath = path.join(
  resourcesRoot,
  "bundled-template-engines",
  "bundle-manifest.json",
)
if (existsSync(manifestPath)) {
  const manifestText = readFileSync(manifestPath, "utf8")
  if (manifestText.includes("/Users/") || manifestText.includes("\\Users\\")) {
    failures.push("template engine manifest contains a development-machine path")
  }
  try {
    const manifest = JSON.parse(manifestText)
    if (manifest.redistribution !== publicReleaseRedistribution) {
      failures.push("template engine manifest is not authorized for public release")
    }
    if (manifest.docx_metadata_policy !== releaseDocxMetadataPolicy) {
      failures.push("template engine manifest has no release DOCX metadata policy")
    }
    for (const engineName of requiredEngineNames) {
      const engine = manifest.engines?.[engineName]
      const engineRoot = path.join(
        resourcesRoot,
        "bundled-template-engines",
        engineName,
      )
      if (!Array.isArray(engine?.files)) {
        failures.push(`${engineName} has no file integrity list`)
      } else {
        for (const fileEntry of engine.files) {
          const relativePath = fileEntry?.path
          if (
            typeof relativePath !== "string" ||
            relativePath.startsWith("/") ||
            relativePath.includes("\\")
          ) {
            failures.push(`${engineName} contains an invalid file path`)
            continue
          }
          const target = path.resolve(engineRoot, relativePath)
          const relativeTarget = path.relative(engineRoot, target)
          if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
            failures.push(`${engineName} contains a file outside its engine root`)
            continue
          }
          requireFile(target, `${engineName} engine file ${relativePath}`)
          if (!existsSync(target) || !statSync(target).isFile()) continue
          if (fileEntry.size_bytes !== statSync(target).size) {
            failures.push(`${engineName} engine file size mismatch: ${relativePath}`)
          }
          if (fileEntry.sha256 !== sha256File(target)) {
            failures.push(`${engineName} engine file hash mismatch: ${relativePath}`)
          }
        }
      }
      const scrubbedFiles = engine?.metadata_scrubbed_files
      if (!Array.isArray(scrubbedFiles) || scrubbedFiles.length !== 1) {
        failures.push(`${engineName} has no single scrubbed official template`)
        continue
      }
      const relativeTemplate = scrubbedFiles[0]
      if (
        typeof relativeTemplate !== "string" ||
        !relativeTemplate.endsWith("/word/official-template.docx")
      ) {
        failures.push(`${engineName} has an invalid scrubbed template path`)
        continue
      }
      const officialTemplate = path.join(engineRoot, relativeTemplate)
      requireFile(officialTemplate, `${engineName} scrubbed official template`)
      const fileEntry = engine.files?.find(
        (candidate) => candidate?.path === relativeTemplate,
      )
      if (fileEntry?.metadata_policy !== releaseDocxMetadataPolicy) {
        failures.push(`${engineName} official template is not marked as scrubbed`)
      }
      if (existsSync(officialTemplate) && statSync(officialTemplate).isFile()) {
        verifyReleaseDocxMetadata(
          officialTemplate,
          `${engineName} official template`,
        )
      }
    }
  } catch {
    failures.push("template engine manifest is not valid JSON")
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(
    JSON.stringify(
      {
        verified: true,
        bundleSignatureVerified: true,
        asarBytes,
        appLocales,
        frameworkLocales,
        runtimeNodeModulesBundled: false,
        documentFontsBundled: false,
        publicTemplateRedistributionVerified: true,
        releaseDocxMetadataPolicy,
      },
      null,
      2,
    ),
  )
}
