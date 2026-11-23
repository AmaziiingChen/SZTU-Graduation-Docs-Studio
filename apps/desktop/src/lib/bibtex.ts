import type {
  BibtexEntry,
  BibtexParseIssue,
  BibtexParseResult,
  FormattedBibtexResult,
  FormattedReference,
} from "@/types/references"
import type {
  RichParagraph,
  StructuredRun,
  StructuredScript,
} from "@/types/structured-content"

const supportedTypes = new Set([
  "article",
  "book",
  "inbook",
  "incollection",
  "inproceedings",
  "conference",
  "proceedings",
  "mastersthesis",
  "phdthesis",
  "techreport",
  "manual",
  "misc",
  "online",
  "electronic",
  "www",
  "patent",
  "standard",
])

const requiredFields: Record<string, readonly string[]> = {
  article: ["author", "title", "journal", "year"],
  book: ["title", "year"],
  inbook: ["author", "title", "booktitle", "year"],
  incollection: ["author", "title", "booktitle", "year"],
  inproceedings: ["author", "title", "booktitle", "year"],
  conference: ["author", "title", "booktitle", "year"],
  proceedings: ["title", "year"],
  mastersthesis: ["author", "title", "school", "year"],
  phdthesis: ["author", "title", "school", "year"],
  techreport: ["author", "title", "institution", "year"],
  manual: ["title"],
  misc: ["title"],
  online: ["title"],
  electronic: ["title"],
  www: ["title"],
  patent: ["author", "title", "year"],
  standard: ["title", "year"],
}

// Only fields that can enter a generated reference may block import because of
// unsupported TeX. Source-only metadata such as abstract, file, and keywords is
// preserved in the draft BibTeX but never reaches the formatted reference.
const renderedFields = new Set([
  "author",
  "editor",
  "title",
  "year",
  "date",
  "journal",
  "booktitle",
  "pages",
  "volume",
  "number",
  "issue",
  "address",
  "location",
  "publisher",
  "institution",
  "school",
  "organization",
  "edition",
  "translator",
  "month",
  "howpublished",
  "doi",
  "url",
  "urldate",
  "accessed",
])

function stableId(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `bib-${(hash >>> 0).toString(16).padStart(8, "0")}`
}

function isIdentifierCharacter(character: string | undefined): boolean {
  return Boolean(character && /[A-Za-z0-9_:\-./]/.test(character))
}

type BibtexValuePart = {
  kind: "literal" | "macro"
  value: string
  offset: number
}

type PendingBibtexEntry = Omit<BibtexEntry, "fields"> & {
  fieldExpressions: Record<string, BibtexValuePart[]>
  offset: number
}

type BibtexMacroDefinition = {
  name: string
  parts: BibtexValuePart[]
  offset: number
}

type MacroResolutionFailure = {
  code: "undefined_macro" | "macro_cycle"
  macro: string
  chain?: string[]
  offset: number
}

type MacroResolution =
  | { ok: true; value: string }
  | { ok: false; failure: MacroResolutionFailure }

class BibtexScanner {
  readonly source: string
  index = 0

  constructor(source: string) {
    this.source = source
  }

  get done(): boolean {
    return this.index >= this.source.length
  }

  peek(): string | undefined {
    return this.source[this.index]
  }

  skipSpaceAndComments(): void {
    while (!this.done) {
      if (/\s/.test(this.peek() ?? "")) {
        this.index += 1
        continue
      }
      if (this.peek() === "%") {
        while (!this.done && this.peek() !== "\n") this.index += 1
        continue
      }
      break
    }
  }

  readIdentifier(): string {
    const start = this.index
    while (isIdentifierCharacter(this.peek())) this.index += 1
    return this.source.slice(start, this.index)
  }

  readUntilTopLevel(stopCharacters: Set<string>): string {
    const start = this.index
    let braceDepth = 0
    let quoted = false
    let escaped = false
    while (!this.done) {
      const character = this.peek() ?? ""
      if (escaped) {
        escaped = false
        this.index += 1
        continue
      }
      if (character === "\\") {
        escaped = true
        this.index += 1
        continue
      }
      if (character === '"' && braceDepth === 0) {
        quoted = !quoted
        this.index += 1
        continue
      }
      if (!quoted) {
        if (character === "{") braceDepth += 1
        if (character === "}" && braceDepth > 0) braceDepth -= 1
        if (braceDepth === 0 && stopCharacters.has(character)) break
      }
      this.index += 1
    }
    return this.source.slice(start, this.index)
  }

  readBracedValue(): string {
    const open = this.peek()
    if (open !== "{") throw new Error("expected brace")
    this.index += 1
    const start = this.index
    let depth = 1
    let escaped = false
    while (!this.done) {
      const character = this.peek() ?? ""
      if (escaped) {
        escaped = false
        this.index += 1
        continue
      }
      if (character === "\\") {
        escaped = true
        this.index += 1
        continue
      }
      if (character === "{") depth += 1
      if (character === "}") {
        depth -= 1
        if (depth === 0) {
          const value = this.source.slice(start, this.index)
          this.index += 1
          return value
        }
      }
      this.index += 1
    }
    throw new Error("花括号没有闭合")
  }

  readQuotedValue(): string {
    if (this.peek() !== '"') throw new Error("expected quote")
    this.index += 1
    const start = this.index
    let braceDepth = 0
    let escaped = false
    while (!this.done) {
      const character = this.peek() ?? ""
      if (escaped) {
        escaped = false
        this.index += 1
        continue
      }
      if (character === "\\") {
        escaped = true
        this.index += 1
        continue
      }
      if (character === "{") braceDepth += 1
      if (character === "}" && braceDepth > 0) braceDepth -= 1
      if (character === '"' && braceDepth === 0) {
        const value = this.source.slice(start, this.index)
        this.index += 1
        return value
      }
      this.index += 1
    }
    throw new Error("引号没有闭合")
  }

  readValueParts(entryClose: string): BibtexValuePart[] {
    const parts: BibtexValuePart[] = []
    while (!this.done) {
      this.skipSpaceAndComments()
      const offset = this.index
      const character = this.peek()
      if (character === "{") {
        parts.push({ kind: "literal", value: this.readBracedValue(), offset })
      } else if (character === '"') {
        parts.push({ kind: "literal", value: this.readQuotedValue(), offset })
      } else {
        const bare = this.readUntilTopLevel(new Set([",", "#", entryClose])).trim()
        if (bare) {
          parts.push({
            kind: /^[-+]?\d+(?:\.\d+)?$/.test(bare) ? "literal" : "macro",
            value: bare,
            offset,
          })
        }
      }
      this.skipSpaceAndComments()
      if (this.peek() !== "#") break
      this.index += 1
    }
    return parts
  }

  recover(): void {
    const next = this.source.indexOf("@", Math.max(this.index + 1, 0))
    this.index = next === -1 ? this.source.length : next
  }
}

function issue(
  code: BibtexParseIssue["code"],
  message: string,
  offset: number,
  details: Partial<Pick<BibtexParseIssue, "citationKey" | "field">> = {},
): BibtexParseIssue {
  return { code, message, offset, ...details }
}

function skipDirectiveBody(scanner: BibtexScanner, close: string): void {
  let depth = 1
  let quoted = false
  let escaped = false
  const open = close === "}" ? "{" : "("
  while (!scanner.done && depth > 0) {
    const character = scanner.peek() ?? ""
    scanner.index += 1
    if (escaped) {
      escaped = false
      continue
    }
    if (character === "\\") {
      escaped = true
      continue
    }
    if (character === '"') quoted = !quoted
    if (quoted) continue
    if (character === open) depth += 1
    if (character === close) depth -= 1
  }
}

const builtInStringMacros: Record<string, string> = {
  jan: "January",
  feb: "February",
  mar: "March",
  apr: "April",
  may: "May",
  jun: "June",
  jul: "July",
  aug: "August",
  sep: "September",
  oct: "October",
  nov: "November",
  dec: "December",
}

function fallbackValue(parts: readonly BibtexValuePart[]): string {
  return parts.map((part) => part.value).join("")
}

export function parseBibtex(source: string): BibtexParseResult {
  const scanner = new BibtexScanner(source)
  const pendingEntries: PendingBibtexEntry[] = []
  const macroDefinitions = new Map<string, BibtexMacroDefinition>()
  const issues: BibtexParseIssue[] = []
  const seenKeys = new Set<string>()

  while (!scanner.done) {
    scanner.skipSpaceAndComments()
    if (scanner.done || !scanner.source.slice(scanner.index).trim()) break
    const entryOffset = scanner.index
    if (scanner.peek() !== "@") {
      issues.push(issue("syntax", "BibTeX 条目必须以 @ 开始。", entryOffset))
      scanner.recover()
      continue
    }
    scanner.index += 1
    const type = scanner.readIdentifier().toLowerCase()
    scanner.skipSpaceAndComments()
    const open = scanner.peek()
    if (!type || (open !== "{" && open !== "(")) {
      issues.push(issue("syntax", "BibTeX 条目类型或起始括号无效。", entryOffset))
      scanner.recover()
      continue
    }
    scanner.index += 1
    const close = open === "{" ? "}" : ")"
    if (["comment", "preamble"].includes(type)) {
      skipDirectiveBody(scanner, close)
      continue
    }

    if (type === "string") {
      try {
        scanner.skipSpaceAndComments()
        const nameOffset = scanner.index
        const name = scanner.readIdentifier()
        scanner.skipSpaceAndComments()
        if (!name || scanner.peek() !== "=") {
          throw new Error("@string 缺少宏名称或等号")
        }
        scanner.index += 1
        const parts = scanner.readValueParts(close)
        if (parts.length === 0) throw new Error(`@string 宏 ${name} 没有值`)
        scanner.skipSpaceAndComments()
        if (scanner.peek() === ",") {
          scanner.index += 1
          scanner.skipSpaceAndComments()
        }
        if (scanner.peek() !== close) {
          throw new Error(`@string 宏 ${name} 的括号没有闭合`)
        }
        scanner.index += 1
        const normalizedName = name.toLowerCase()
        if (macroDefinitions.has(normalizedName)) {
          issues.push(
            issue(
              "syntax",
              `@string 宏 ${name} 重复定义。`,
              nameOffset,
              { field: name },
            ),
          )
          continue
        }
        macroDefinitions.set(normalizedName, {
          name,
          parts,
          offset: nameOffset,
        })
      } catch (error) {
        issues.push(
          issue(
            "syntax",
            error instanceof Error ? error.message : "@string 语法无效。",
            entryOffset,
          ),
        )
        scanner.recover()
      }
      continue
    }

    try {
      scanner.skipSpaceAndComments()
      const citationKey = scanner.readUntilTopLevel(new Set([",", close])).trim()
      if (!citationKey || scanner.peek() !== ",") {
        throw new Error("缺少引用键或引用键后的逗号")
      }
      scanner.index += 1
      const fieldExpressions: Record<string, BibtexValuePart[]> = {}
      let closed = false
      while (!scanner.done) {
        scanner.skipSpaceAndComments()
        if (scanner.peek() === close) {
          scanner.index += 1
          closed = true
          break
        }
        if (scanner.peek() === ",") {
          scanner.index += 1
          continue
        }
        const fieldOffset = scanner.index
        const field = scanner.readIdentifier().toLowerCase()
        scanner.skipSpaceAndComments()
        if (!field || scanner.peek() !== "=") {
          throw new Error(`字段定义无效（位置 ${fieldOffset}）`)
        }
        scanner.index += 1
        const value = scanner.readValueParts(close)
        if (value.length === 0) throw new Error(`字段 ${field} 没有值`)
        fieldExpressions[field] = value
        scanner.skipSpaceAndComments()
        if (scanner.peek() === ",") scanner.index += 1
      }
      if (!closed) throw new Error("条目括号没有闭合")

      const normalizedKey = citationKey.toLocaleLowerCase()
      if (seenKeys.has(normalizedKey)) {
        issues.push(
          issue("duplicate_key", `引用键 ${citationKey} 重复。`, entryOffset, {
            citationKey,
          }),
        )
        continue
      }
      seenKeys.add(normalizedKey)
      pendingEntries.push({
        id: stableId(`${type}:${normalizedKey}`),
        type,
        citationKey,
        fieldExpressions,
        raw: source.slice(entryOffset, scanner.index),
        offset: entryOffset,
      })
    } catch (error) {
      issues.push(
        issue(
          "syntax",
          error instanceof Error ? error.message : "BibTeX 语法无效。",
          entryOffset,
        ),
      )
      scanner.recover()
    }
  }

  const macroCache = new Map<string, string>()
  const resolveParts = (
    parts: readonly BibtexValuePart[],
    stack: readonly string[],
    visited?: Set<string>,
  ): MacroResolution => {
    let value = ""
    for (const part of parts) {
      if (part.kind === "literal") {
        value += part.value
        continue
      }
      const resolved = resolveMacro(part.value, stack, visited, part.offset)
      if (!resolved.ok) return resolved
      value += resolved.value
    }
    return { ok: true, value }
  }
  const resolveMacro = (
    rawName: string,
    stack: readonly string[] = [],
    visited?: Set<string>,
    referenceOffset = 0,
  ): MacroResolution => {
    const name = rawName.toLowerCase()
    visited?.add(name)
    const cycleStart = stack.indexOf(name)
    if (cycleStart !== -1) {
      return {
        ok: false,
        failure: {
          code: "macro_cycle",
          macro: rawName,
          chain: [...stack.slice(cycleStart), name],
          offset: referenceOffset,
        },
      }
    }
    const builtIn = builtInStringMacros[name]
    if (builtIn) return { ok: true, value: builtIn }
    const cached = macroCache.get(name)
    if (cached !== undefined) return { ok: true, value: cached }
    const definition = macroDefinitions.get(name)
    if (!definition) {
      return {
        ok: false,
        failure: {
          code: "undefined_macro",
          macro: rawName,
          offset: referenceOffset,
        },
      }
    }
    const resolved = resolveParts(definition.parts, [...stack, name], visited)
    if (resolved.ok) macroCache.set(name, resolved.value)
    return resolved
  }

  const entries: BibtexEntry[] = []
  const usedMacros = new Set<string>()
  for (const pending of pendingEntries) {
    const fields: Record<string, string> = {}
    for (const [field, expression] of Object.entries(pending.fieldExpressions)) {
      const resolved = resolveParts(expression, [], usedMacros)
      fields[field] = resolved.ok ? resolved.value : fallbackValue(expression)
      if (!resolved.ok && renderedFields.has(field)) {
        const failure = resolved.failure
        issues.push(
          issue(
            failure.code,
            failure.code === "macro_cycle"
              ? `${pending.citationKey} 的 ${field} 字段存在 @string 循环引用：${failure.chain?.join(" -> ")}。`
              : `${pending.citationKey} 的 ${field} 字段引用了未定义的 @string 宏 ${failure.macro}。`,
            failure.offset || pending.offset,
            { citationKey: pending.citationKey, field },
          ),
        )
        continue
      }
      if (!resolved.ok || !renderedFields.has(field)) continue
      const unsupportedCommands = analyzeBibtexText(
        resolved.value,
      ).unsupportedCommands
      for (const command of new Set(unsupportedCommands)) {
        issues.push(
          issue(
            "unsupported_command",
            `${pending.citationKey} 的 ${field} 字段包含暂不支持的 TeX 命令 \\${command}。请改为普通文字或支持的命令。`,
            pending.offset,
            { citationKey: pending.citationKey, field },
          ),
        )
      }
    }

    const entry: BibtexEntry = {
      id: pending.id,
      type: pending.type,
      citationKey: pending.citationKey,
      fields,
      raw: pending.raw,
    }
    entries.push(entry)

    if (!supportedTypes.has(entry.type)) {
      issues.push(
        issue(
          "unsupported_type",
          `暂不支持 @${entry.type}，请改为常见文献类型后再导出。`,
          pending.offset,
          { citationKey: entry.citationKey },
        ),
      )
    }
    for (const field of requiredFields[entry.type] ?? []) {
      if (!fields[field]?.trim()) {
        issues.push(
          issue(
            "missing_field",
            `${entry.citationKey} 缺少 ${field} 字段。`,
            pending.offset,
            { citationKey: entry.citationKey, field },
          ),
        )
      }
    }
  }

  const checkedUnusedMacros = new Set(usedMacros)
  const reportedUnusedFailures = new Set<string>()
  for (const [name, definition] of macroDefinitions) {
    if (checkedUnusedMacros.has(name)) continue
    const visited = new Set<string>()
    const resolved = resolveMacro(name, [], visited, definition.offset)
    for (const visitedName of visited) checkedUnusedMacros.add(visitedName)
    if (!resolved.ok) {
      const failure = resolved.failure
      const signature = `${failure.code}:${failure.chain?.join(">") ?? failure.macro}`
      if (reportedUnusedFailures.has(signature)) continue
      reportedUnusedFailures.add(signature)
      issues.push(
        issue(
          failure.code,
          failure.code === "macro_cycle"
            ? `@string 宏存在循环引用：${failure.chain?.join(" -> ")}。`
            : `@string 宏 ${definition.name} 引用了未定义宏 ${failure.macro}。`,
          failure.offset || definition.offset,
          { field: definition.name },
        ),
      )
    }
  }

  if (source.trim() && entries.length === 0 && issues.length === 0) {
    issues.push(issue("syntax", "没有找到可解析的 BibTeX 条目。", 0))
  }
  return { entries, issues }
}

type TitleRunStyle = {
  bold?: boolean
  italic?: boolean
  script?: StructuredScript
}

// This is the single conservative allowlist used by plain-text decoding,
// rich-title runs, and parse-time validation. Commands outside this list are
// rendered without their control word and reported as unsupported.
const textArgumentCommands: Record<string, TitleRunStyle> = {
  textbf: { bold: true },
  mathbf: { bold: true },
  textit: { italic: true },
  emph: { italic: true },
  mathrm: {},
  textrm: {},
  textnormal: {},
  operatorname: {},
  textsubscript: { script: "sub" },
  textsuperscript: { script: "super" },
}

const directTextCommands: Record<string, string> = {
  ss: "ß",
  ae: "æ",
  AE: "Æ",
  oe: "œ",
  OE: "Œ",
  aa: "å",
  AA: "Å",
  o: "ø",
  O: "Ø",
  l: "ł",
  L: "Ł",
  TeX: "TeX",
  LaTeX: "LaTeX",
  mu: "μ",
  textcelsius: "℃",
}

const escapedTextCharacters: Record<string, string> = {
  "&": "&",
  "%": "%",
  "#": "#",
  _: "_",
  "{": "{",
  "}": "}",
  "$": "$",
}

const combiningAccentMarks: Record<string, string> = {
  '"': "\u0308",
  "'": "\u0301",
  "`": "\u0300",
  "~": "\u0303",
  "^": "\u0302",
  "=": "\u0304",
  ".": "\u0307",
}

function sameRunStyle(left: StructuredRun, right: StructuredRun): boolean {
  return (
    left.bold === right.bold &&
    left.italic === right.italic &&
    (left.script ?? "normal") === (right.script ?? "normal")
  )
}

function appendStructuredRun(
  target: StructuredRun[],
  text: string,
  style: TitleRunStyle = {},
): void {
  if (!text) return
  const run: StructuredRun = {
    text,
    ...(style.bold ? { bold: true } : {}),
    ...(style.italic ? { italic: true } : {}),
    ...(style.script && style.script !== "normal"
      ? { script: style.script }
      : {}),
  }
  const previous = target.at(-1)
  if (previous && sameRunStyle(previous, run)) {
    previous.text += run.text
  } else {
    target.push(run)
  }
}

function mergeTitleStyle(
  base: TitleRunStyle,
  addition: TitleRunStyle,
): TitleRunStyle {
  return {
    ...(base.bold || addition.bold ? { bold: true } : {}),
    ...(base.italic || addition.italic ? { italic: true } : {}),
    ...(addition.script
      ? { script: addition.script }
      : base.script
        ? { script: base.script }
        : {}),
  }
}

type BibtexTextAnalysis = {
  runs: StructuredRun[]
  unsupportedCommands: string[]
}

class BibtexTextScanner {
  readonly source: string
  index = 0
  readonly unsupportedCommands: string[] = []

  constructor(source: string) {
    this.source = source
  }

  private get done(): boolean {
    return this.index >= this.source.length
  }

  private peek(): string | undefined {
    return this.source[this.index]
  }

  private skipSpace(): void {
    while (/\s/.test(this.peek() ?? "")) this.index += 1
  }

  private readAccentTarget(): string {
    this.skipSpace()
    if (this.peek() === "{") {
      this.index += 1
      const start = this.index
      while (!this.done && this.peek() !== "}") this.index += 1
      const value = this.source.slice(start, this.index)
      if (this.peek() === "}") this.index += 1
      return value
    }
    const value = this.peek() ?? ""
    if (value) this.index += 1
    return value
  }

  private appendAccent(
    target: StructuredRun[],
    style: TitleRunStyle,
    mark: string,
  ): void {
    const value = this.readAccentTarget()
    if (!value) {
      this.unsupportedCommands.push(mark)
      return
    }
    appendStructuredRun(target, `${value}${mark}`.normalize("NFC"), style)
  }

  private parseCommand(style: TitleRunStyle, target: StructuredRun[]): void {
    this.index += 1
    const commandStart = this.index
    while (/[A-Za-z]/.test(this.peek() ?? "")) this.index += 1
    const command = this.source.slice(commandStart, this.index)

    if (!command) {
      const escaped = this.peek() ?? ""
      if (!escaped) {
        appendStructuredRun(target, "\\", style)
        return
      }
      this.index += 1
      const escapedText = escapedTextCharacters[escaped]
      if (escapedText !== undefined) {
        appendStructuredRun(target, escapedText, style)
        return
      }
      const accentMark = combiningAccentMarks[escaped]
      if (accentMark !== undefined) {
        this.appendAccent(target, style, accentMark)
        return
      }
      this.unsupportedCommands.push(escaped)
      appendStructuredRun(target, escaped, style)
      return
    }

    const directText = directTextCommands[command]
    if (directText !== undefined) {
      appendStructuredRun(target, directText, style)
      return
    }

    if (command === "c") {
      this.appendAccent(target, style, "\u0327")
      return
    }

    const commandStyle = textArgumentCommands[command]
    if (!commandStyle) {
      this.unsupportedCommands.push(command)
      this.skipSpace()
      if (this.peek() === "{") {
        this.index += 1
        this.parseRuns(style, target, "}")
      } else {
        appendStructuredRun(target, command, style)
      }
      return
    }

    this.skipSpace()
    if (this.peek() !== "{") {
      this.unsupportedCommands.push(command)
      appendStructuredRun(target, command, mergeTitleStyle(style, commandStyle))
      return
    }
    this.index += 1
    this.parseRuns(mergeTitleStyle(style, commandStyle), target, "}")
  }

  private parseScript(style: TitleRunStyle, target: StructuredRun[]): void {
    const marker = this.peek()
    this.index += 1
    this.skipSpace()
    const scriptStyle = mergeTitleStyle(style, {
      script: marker === "_" ? "sub" : "super",
    })
    if (this.peek() === "{") {
      this.index += 1
      this.parseRuns(scriptStyle, target, "}")
      return
    }
    const character = this.peek()
    if (!character) {
      appendStructuredRun(target, marker ?? "", style)
      return
    }
    if (character === "\\") {
      this.parseCommand(scriptStyle, target)
      return
    }
    this.index += 1
    appendStructuredRun(target, character, scriptStyle)
  }

  parseRuns(
    style: TitleRunStyle = {},
    target: StructuredRun[] = [],
    close?: string,
  ): StructuredRun[] {
    let plain = ""
    const flushPlain = () => {
      appendStructuredRun(
        target,
        plain.replace(/~/g, " ").replace(/\s+/g, " "),
        style,
      )
      plain = ""
    }

    while (!this.done) {
      const character = this.peek() ?? ""
      if (close && character === close) {
        flushPlain()
        this.index += 1
        return target
      }
      if (character === "{") {
        flushPlain()
        this.index += 1
        this.parseRuns(style, target, "}")
        continue
      }
      if (character === "}") {
        // A stray closing brace is formatting syntax, never rendered as content.
        flushPlain()
        this.index += 1
        continue
      }
      if (character === "\\") {
        flushPlain()
        this.parseCommand(style, target)
        continue
      }
      if (character === "_" || character === "^") {
        flushPlain()
        this.parseScript(style, target)
        continue
      }
      if (character === "$") {
        // Math delimiters only scope TeX input; script markers carry the semantics.
        flushPlain()
        this.index += 1
        continue
      }
      plain += character
      this.index += 1
    }
    flushPlain()
    return target
  }
}

function normalizeStructuredRuns(runs: StructuredRun[]): StructuredRun[] {
  const normalized: StructuredRun[] = []
  for (const rawRun of runs) {
    let text = rawRun.text.replace(/\s+/g, " ")
    if (!normalized.length) text = text.replace(/^\s+/, "")
    const previous = normalized.at(-1)
    if (previous?.text.endsWith(" ")) text = text.replace(/^\s+/, "")
    appendStructuredRun(normalized, text, rawRun)
  }
  const last = normalized.at(-1)
  if (last) last.text = last.text.replace(/\s+$/, "")
  return normalized.filter((run) => run.text.length > 0)
}

function analyzeBibtexText(value: string): BibtexTextAnalysis {
  const scanner = new BibtexTextScanner(value)
  return {
    runs: normalizeStructuredRuns(scanner.parseRuns()),
    unsupportedCommands: scanner.unsupportedCommands,
  }
}

export function decodeBibtexText(value: string): string {
  return analyzeBibtexText(value).runs
    .map((run) => {
      const marker =
        run.script === "sub" ? "_" : run.script === "super" ? "^" : ""
      return `${marker}${run.text}`
    })
    .join("")
    .trim()
}

export function bibtexTitleRuns(value: string): StructuredRun[] {
  return analyzeBibtexText(value).runs
}

function referenceParagraph(
  template: string,
  titleToken: string,
  titleRuns: StructuredRun[],
): RichParagraph {
  const tokenOffset = template.indexOf(titleToken)
  if (tokenOffset === -1) return { type: "paragraph", runs: [{ text: template }] }
  const runs: StructuredRun[] = []
  appendStructuredRun(runs, template.slice(0, tokenOffset))
  for (const run of titleRuns) appendStructuredRun(runs, run.text, run)
  appendStructuredRun(runs, template.slice(tokenOffset + titleToken.length))
  return { type: "paragraph", runs }
}

// GB/T 7714—2025 的著录符号按语种区分：中文条目用全角，西文条目用半角。
// 与论文模板的 bst（control.bib.punct = bylanguage）保持一致。
interface PublishingPunctuation {
  comma: string
  colon: string
  period: string
}

const CJK_PUNCTUATION: PublishingPunctuation = {
  comma: "，",
  colon: "：",
  period: "．",
}

const LATIN_PUNCTUATION: PublishingPunctuation = {
  comma: ", ",
  colon: ": ",
  period: ".",
}

// .bib 字段只应存内容，句点由样式补。导出工具或手工录入常把结尾句点带进来，
// 这里统一剥掉，避免拼出 "et al.."、"[J]." 两连点或 "DOI: 10.1/x.."。
// 只处理结尾的句读，不动字段中间的标点，也不动作者/版次（首字母与 Jr. 合法带点）。
const TRAILING_SENTENCE_PUNCTUATION = /[\s.。．,，;；、:：]+$/

function trimField(value: string): string {
  return value.replace(TRAILING_SENTENCE_PUNCTUATION, "")
}

function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value)
}

function punctuationFor(
  fields: Record<string, string>,
  title: string,
): PublishingPunctuation {
  const sample = `${fields.author ?? ""}${fields.editor ?? ""}${title}${fields.journal ?? ""}${fields.booktitle ?? ""}`
  return containsCjk(sample) ? CJK_PUNCTUATION : LATIN_PUNCTUATION
}

// GB/T 7714—2025：西文责任者写姓 + 名首字母（Lamport L.），中文责任者保持全名。
function initials(given: string): string {
  if (containsCjk(given)) return given
  const parts = given
    .split(/[\s.]+/)
    .filter(Boolean)
    .flatMap((part) => part.split("-"))
  return parts
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}.`)
    .join(" ")
}

function authors(
  value: string | undefined,
  punctuation: PublishingPunctuation,
): string {
  if (!value) return ""
  const names = value
    .split(/\s+and\s+/i)
    .map(decodeBibtexText)
    .map((name) => {
      const [family, given] = name.split(/\s*,\s*/, 2)
      return given ? `${family} ${initials(given)}` : name
    })
    .filter(Boolean)
  if (names.length <= 3) return names.join(punctuation.comma)
  const chinese = names.slice(0, 3).some(containsCjk)
  const listed = names.slice(0, 3).join(punctuation.comma)
  return `${listed}${punctuation.comma}${chinese ? "等" : "et al."}`
}

function creator(
  fields: Record<string, string>,
  punctuation: PublishingPunctuation,
): string {
  if (fields.author) return authors(fields.author, punctuation)
  if (fields.editor) {
    const editor = authors(fields.editor, punctuation)
    return editor ? `${editor}${punctuation.comma}编` : ""
  }
  return ""
}

function joinNonEmpty(parts: Array<string | undefined>, separator: string): string {
  return parts.filter((part): part is string => Boolean(part?.trim())).join(separator)
}

function locationAndPublisher(
  fields: Record<string, string>,
  punctuation: PublishingPunctuation,
): string {
  const place = trimField(decodeBibtexText(fields.address ?? fields.location ?? ""))
  const publisher = trimField(
    decodeBibtexText(fields.publisher ?? fields.institution ?? fields.school ?? ""),
  )
  if (place && publisher) return `${place}${punctuation.colon}${publisher}`
  // 出版地或出版者缺项时按 GB/T 7714 补齐占位，而不是静默省略。
  const unknownPlace = punctuation.period === "." ? "S.l." : "出版地不详"
  const unknownPublisher = punctuation.period === "." ? "s.n." : "出版者不详"
  return `${place || unknownPlace}${punctuation.colon}${publisher || unknownPublisher}`
}

function publicationDate(fields: Record<string, string>): string {
  const date = trimField(decodeBibtexText(fields.date ?? ""))
  if (date) return date
  return joinNonEmpty(
    [
      trimField(decodeBibtexText(fields.year ?? "")),
      trimField(decodeBibtexText(fields.month ?? "")),
    ],
    "-",
  )
}

function ordinal(value: string): string {
  if (!/^\d+$/.test(value)) return value
  const number = Number(value)
  const suffix =
    number % 100 >= 11 && number % 100 <= 13
      ? "th"
      : number % 10 === 1
        ? "st"
        : number % 10 === 2
          ? "nd"
          : number % 10 === 3
            ? "rd"
            : "th"
  return `${number}${suffix}`
}

function edition(fields: Record<string, string>, title: string): string {
  const value = decodeBibtexText(fields.edition ?? "")
  if (!value) return value
  const chinese = /[\u3400-\u9fff]/.test(title)
  if (chinese) return /版$/.test(value) ? value : `${value}版`
  const bare = value.replace(/\s*ed(?:ition)?\.?$/i, "")
  return bare === value && /ed/i.test(value) ? value : `${ordinal(bare)} ed.`
}

function publicationDetails(
  fields: Record<string, string>,
  title: string,
  punctuation: PublishingPunctuation,
  includePages = false,
): string {
  const editionValue = edition(fields, title)
  const editionPeriod = editionValue.endsWith(".") ? "" : punctuation.period
  const head = editionValue ? `${editionValue}${editionPeriod} ` : ""
  return (
    head +
    joinNonEmpty(
      [
        locationAndPublisher(fields, punctuation),
        publicationDate(fields),
        includePages
          ? trimField(decodeBibtexText(fields.pages ?? "")).replace(/--/g, "-")
          : "",
      ],
      punctuation.comma,
    )
  )
}

function volumeIssuePages(
  fields: Record<string, string>,
  punctuation: PublishingPunctuation,
): string {
  const volume = trimField(decodeBibtexText(fields.volume ?? ""))
  const number = trimField(decodeBibtexText(fields.number ?? fields.issue ?? ""))
  const pages = trimField(decodeBibtexText(fields.pages ?? "")).replace(/--/g, "-")
  const latin = punctuation.period === "."
  const volumeIssue = `${volume}${number ? `${latin ? "(" : "（"}${number}${latin ? ")" : "）"}` : ""}`
  if (volumeIssue && pages) return `${volumeIssue}${punctuation.colon}${pages}`
  return volumeIssue || pages
}

function appendIdentifier(
  text: string,
  fields: Record<string, string>,
  punctuation: PublishingPunctuation,
): string {
  const doi = trimField(decodeBibtexText(fields.doi ?? ""))
  const url = trimField(decodeBibtexText(fields.url ?? ""))
  if (doi) return `${text} DOI: ${doi}${punctuation.period}`
  if (url) return `${text} ${url}${punctuation.period}`
  return text
}

// 网络资源的出版年按 GB/T 7714—2025 用圆括号包裹：(2026-08-01)。
function publicationStamp(
  year: string,
  punctuation: PublishingPunctuation,
): string {
  if (!year) return ""
  const latin = punctuation.period === "."
  return `${latin ? "(" : "（"}${year}${latin ? ")" : "）"}`
}

// 网络资源的引用日期紧跟出版日期，如 (2026-08-01)[2026-09-02]。
function accessStamp(fields: Record<string, string>): string {
  const accessed = trimField(decodeBibtexText(fields.urldate ?? fields.accessed ?? ""))
  return accessed ? `[${accessed}]` : ""
}

function terminal(value: string, punctuation: PublishingPunctuation): string {
  const trimmed = value.trim()
  const closing = punctuation.period === "." ? /[.。!?]$/ : /[。．!?！？]$/
  return closing.test(trimmed) ? trimmed : `${trimmed}${punctuation.period}`
}

export function formatBibtexEntry(
  entry: BibtexEntry,
  index: number,
): FormattedReference {
  const fields = entry.fields
  // 题名同样剥掉结尾句点，并让富文本片段用同一份原始串，避免文本与段落不一致。
  const rawTitle = trimField(fields.title ?? "").trim() || entry.citationKey
  const title = decodeBibtexText(rawTitle)
  const punctuation = punctuationFor(fields, title)
  const latin = punctuation.period === "."
  const comma = punctuation.comma
  const period = punctuation.period

  const formattedCreator = creator(fields, punctuation)
  const year = publicationDate(fields)
  const journal = trimField(decodeBibtexText(fields.journal ?? ""))
  const booktitle = trimField(decodeBibtexText(fields.booktitle ?? ""))
  const pages = trimField(decodeBibtexText(fields.pages ?? "")).replace(/--/g, "-")
  // 西文姓名首字母本身以句点结尾（Lamport L.），不再重复加句点。
  const creatorPeriod = formattedCreator.endsWith(".") ? "" : period
  const prefix = `[${index + 1}] ${formattedCreator ? `${formattedCreator}${creatorPeriod} ` : ""}`
  const translator = authors(fields.translator, punctuation)
  const translatedResponsibility = translator ? `${translator}${comma}译${period} ` : ""
  // 类型标识之后：西文条目留一个空格，中文条目直接接下一个著录项。
  const afterTag = `${period}${latin ? " " : ""}`
  const formatWithTitle = (formattedTitle: string): string => {
    let body: string
    switch (entry.type) {
      case "article":
        body = `${prefix}${formattedTitle}[J]${afterTag}${joinNonEmpty(
          [journal, year, volumeIssuePages(fields, punctuation)],
          comma,
        )}`
        break
      case "book":
        body = `${prefix}${formattedTitle}[M]${afterTag}${translatedResponsibility}${publicationDetails(fields, title, punctuation, true)}`
        break
      case "inbook":
      case "incollection":
        body = `${prefix}${formattedTitle}[M]//${booktitle}${afterTag}${publicationDetails(fields, booktitle || title, punctuation, true)}`
        break
      case "inproceedings":
      case "conference":
        body = `${prefix}${formattedTitle}[C]//${booktitle}${afterTag}${joinNonEmpty(
          [locationAndPublisher(fields, punctuation), year, pages],
          comma,
        )}`
        break
      case "proceedings":
        body = `${prefix}${formattedTitle}[C]${afterTag}${publicationDetails(fields, title, punctuation, true)}`
        break
      case "mastersthesis":
      case "phdthesis":
        body = `${prefix}${formattedTitle}[D]${afterTag}${joinNonEmpty(
          [locationAndPublisher(fields, punctuation), year],
          comma,
        )}`
        break
      case "techreport":
        body = `${prefix}${formattedTitle}[R]${afterTag}${joinNonEmpty(
          [
            locationAndPublisher(fields, punctuation),
            year,
            trimField(decodeBibtexText(fields.number ?? "")),
          ],
          comma,
        )}`
        break
      case "patent":
        body = `${prefix}${formattedTitle}[P]${afterTag}${joinNonEmpty(
          [trimField(decodeBibtexText(fields.number ?? "")), year],
          comma,
        )}`
        break
      case "online":
      case "electronic":
      case "www":
        body = `${prefix}${formattedTitle}[EB/OL]${afterTag}${publicationStamp(year, punctuation)}${accessStamp(fields)}`
        break
      case "misc":
        body = fields.url
          ? `${prefix}${formattedTitle}[EB/OL]${afterTag}${publicationStamp(year, punctuation)}${accessStamp(fields)}`
          : `${prefix}${formattedTitle}[Z]${afterTag}${year}`
        break
      case "manual":
        body = `${prefix}${formattedTitle}[M]${afterTag}${publicationDetails(fields, title, punctuation, true)}`
        break
      case "standard": {
        // GB/T 7714—2025：标准号置于题名之前。
        const number = trimField(decodeBibtexText(fields.number ?? ""))
        const standardTitle =
          number && !title.includes(number)
            ? `${number} ${formattedTitle}`
            : formattedTitle
        body = `${prefix}${standardTitle}[S]${afterTag}${joinNonEmpty(
          [trimField(decodeBibtexText(fields.organization ?? "")), year],
          comma,
        )}`
        break
      }
      default:
        body = `${prefix}${formattedTitle}[Z]${afterTag}${year}`
    }
    return appendIdentifier(terminal(body, punctuation), fields, punctuation)
  }

  const titleToken = `\u0000title:${entry.id}\u0000`
  const text = formatWithTitle(title)
  const paragraphTemplate = formatWithTitle(titleToken)

  return {
    id: entry.id,
    citationKey: entry.citationKey,
    sourceType: entry.type,
    text,
    paragraph: referenceParagraph(
      paragraphTemplate,
      titleToken,
      bibtexTitleRuns(rawTitle),
    ),
  }
}

export function formatBibtex(source: string): FormattedBibtexResult {
  const parsed = parseBibtex(source)
  return {
    ...parsed,
    references: parsed.entries.map(formatBibtexEntry),
  }
}
