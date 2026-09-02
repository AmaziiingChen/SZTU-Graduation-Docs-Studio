import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const rendererRoot = path.join(repositoryRoot, "apps", "desktop", "src")
const themePath = path.join(rendererRoot, "index.css")
const savedStatusPath = path.join(
  rendererRoot,
  "components",
  "workbench",
  "save-status-badge.tsx",
)
const exportHistoryStatusPath = path.join(
  rendererRoot,
  "components",
  "workbench",
  "export-history-status-badge.tsx",
)
const sectionCompletionMarkPath = path.join(
  rendererRoot,
  "components",
  "workbench",
  "section-completion-mark.tsx",
)
const referenceImporterPath = path.join(
  rendererRoot,
  "components",
  "workbench",
  "reference-importer.tsx",
)

const requiredFontStack =
  "--font-sans: 'Geist Variable', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Noto Sans SC', system-ui, sans-serif;"
const approvedSavedStateClasses = new Set([
  "border-emerald-200",
  "bg-emerald-50",
  "text-emerald-700",
  "dark:border-emerald-800/60",
  "dark:bg-emerald-950/40",
  "dark:text-emerald-300",
])
const approvedExportHistoryStateClasses = new Set([
  "border-emerald-200",
  "bg-emerald-50",
  "text-emerald-700",
  "dark:border-emerald-800/60",
  "dark:bg-emerald-950/40",
  "dark:text-emerald-300",
  "border-amber-200",
  "bg-amber-50",
  "text-amber-700",
  "dark:border-amber-800/60",
  "dark:bg-amber-950/40",
  "dark:text-amber-300",
  "border-sky-200",
  "bg-sky-50",
  "text-sky-700",
  "dark:border-sky-800/60",
  "dark:bg-sky-950/40",
  "dark:text-sky-300",
])
const approvedSectionCompletionClasses = new Set(["fill-emerald-500"])
const approvedPaletteClassesByFile = new Map([
  [savedStatusPath, approvedSavedStateClasses],
  [exportHistoryStatusPath, approvedExportHistoryStateClasses],
  [sectionCompletionMarkPath, approvedSectionCompletionClasses],
])
const paletteClassPattern =
  /\b(?:dark:)?(?:bg|text|border|ring|fill|stroke)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-[0-9]+(?:\/[0-9]+)?\b/g
const literalColorPattern = /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch)\s*\(/gi
const directFontPattern = /\bfont-(?:sans|serif|\[[^\]]+\])\b|\bfontFamily\s*:/g
const monoFontPattern = /\bfont-mono\b/g

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (
        absolutePath === path.join(rendererRoot, "components", "ui") ||
        absolutePath === path.join(rendererRoot, "assets")
      ) {
        continue
      }
      files.push(...(await collectFiles(absolutePath)))
      continue
    }

    if (!/\.(?:css|ts|tsx)$/.test(entry.name) || /\.test\.[^.]+$/.test(entry.name)) {
      continue
    }
    files.push(absolutePath)
  }

  return files
}

function lineNumber(source, index) {
  return source.slice(0, index).split("\n").length
}

function report(issues, filePath, source, match, message) {
  issues.push(
    `${path.relative(repositoryRoot, filePath)}:${lineNumber(source, match.index)} ${message}: ${match[0]}`,
  )
}

const issues = []
const theme = await readFile(themePath, "utf8")
if (!theme.includes(requiredFontStack)) {
  issues.push(
    `${path.relative(repositoryRoot, themePath)} must keep the approved Geist and CJK system fallback stack.`,
  )
}

for (const filePath of await collectFiles(rendererRoot)) {
  const source = await readFile(filePath, "utf8")

  for (const match of source.matchAll(paletteClassPattern)) {
    if (!approvedPaletteClassesByFile.get(filePath)?.has(match[0])) {
      report(
        issues,
        filePath,
        source,
        match,
        "Use a shadcn semantic token; fixed palette classes are reserved for approved centralized status badges",
      )
    }
  }

  if (filePath === savedStatusPath) {
    for (const className of approvedSavedStateClasses) {
      if (!source.includes(className)) {
        issues.push(
          `${path.relative(repositoryRoot, filePath)} is missing approved saved-state class ${className}.`,
        )
      }
    }
  }
  if (filePath === exportHistoryStatusPath) {
    for (const className of approvedExportHistoryStateClasses) {
      if (!source.includes(className)) {
        issues.push(
          `${path.relative(repositoryRoot, filePath)} is missing approved export-history state class ${className}.`,
        )
      }
    }
  }
  if (filePath === sectionCompletionMarkPath) {
    for (const className of approvedSectionCompletionClasses) {
      if (!source.includes(className)) {
        issues.push(
          `${path.relative(repositoryRoot, filePath)} is missing approved document-section completion class ${className}.`,
        )
      }
    }
  }

  if (filePath !== themePath) {
    for (const match of source.matchAll(literalColorPattern)) {
      report(
        issues,
        filePath,
        source,
        match,
        "Use a shadcn semantic color token instead of a literal color",
      )
    }
  }

  if (filePath !== themePath) {
    for (const match of source.matchAll(directFontPattern)) {
      report(
        issues,
        filePath,
        source,
        match,
        "Use the global UI font stack instead of a local font-family override",
      )
    }
  }

  for (const match of source.matchAll(monoFontPattern)) {
    if (filePath !== referenceImporterPath) {
      report(
        issues,
        filePath,
        source,
        match,
        "Monospace is reserved for BibTeX source editing unless a new semantic use is documented",
      )
    }
  }
}

if (issues.length > 0) {
  console.error("Frontend design-system check failed:\n")
  for (const issue of issues) console.error(`- ${issue}`)
  process.exitCode = 1
} else {
  console.log("Frontend design-system check passed.")
}
