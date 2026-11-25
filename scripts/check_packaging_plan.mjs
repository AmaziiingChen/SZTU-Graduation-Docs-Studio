#!/usr/bin/env node
// Packaging pre-flight.
//
// Runs in a couple of seconds and catches the class of mistakes that otherwise
// only surface 25 minutes later inside electron-builder:
//
//   * two extraResources entries writing the same file into the same directory
//     (on Windows that is an EBUSY lock error),
//   * a version that disagrees between the root and the desktop package,
//   * a template pin that disagrees between the workflows and ci-resources,
//   * a document font that the thesis template requires but the bundle lacks.
//
// It deliberately avoids a YAML dependency: these configs use a small, stable
// subset, and a loud failure on an unexpected shape is better than a silently
// wrong plan.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const notes = [];
const allowMissingFonts = process.argv.includes("--allow-missing-fonts");

function fail(message) {
  problems.push(message);
}

function read(relative) {
  return readFileSync(join(ROOT, relative), "utf8");
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

// Extracts every `extraResources:` list in a config, including the ones nested
// under `mac:` / `win:`. Returns entries shaped like
// { source, target, filter, scope } where scope is the owning platform block.
function extraResources(configPath) {
  const lines = read(configPath).split(/\r?\n/);
  const entries = [];
  let scope = "all";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trim().startsWith("#")) continue;

    if (indentOf(line) === 0 && /^[A-Za-z][\w-]*:\s*$/.test(line)) {
      scope = line.trim().slice(0, -1);
    }
    const header = /^(\s*)extraResources:\s*$/.exec(line);
    if (!header) continue;

    const listIndent = header[1].length;
    let current = null;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const row = lines[cursor];
      if (!row.trim()) continue;
      const indent = indentOf(row);
      if (indent <= listIndent) break;

      const item = /^\s*-\s+from:\s*(.+?)\s*$/.exec(row);
      if (item) {
        current = { source: item[1], target: null, filter: [], scope, line: cursor + 1 };
        entries.push(current);
        continue;
      }
      const target = /^\s+to:\s*(.+?)\s*$/.exec(row);
      if (target && current) {
        current.target = target[1];
        continue;
      }
      const filterHeader = /^\s+filter:\s*$/.exec(row);
      if (filterHeader && current) {
        current.filter = [];
        continue;
      }
      const filterItem = /^\s+-\s+(.+?)\s*$/.exec(row);
      if (filterItem && current) {
        current.filter.push(filterItem[1].replace(/^["']|["']$/g, ""));
      }
    }
  }
  return entries;
}

// electron-builder resolves every `from:` relative to the config file, which
// lives in apps/desktop. Keep that base for absolute and relative sources alike.
function expandSource(source) {
  return resolve(join(ROOT, "apps/desktop"), source);
}

function filesFor(entry) {
  const directory = expandSource(entry.source);
  if (!existsSync(directory)) return { directory, files: [], missing: true };
  const stats = statSync(directory);
  if (!stats.isDirectory()) return { directory, files: [basename(directory)], missing: false };

  const candidates = existsSync(directory) ? readdirSync(directory) : [];
  if (entry.filter.length === 0) return { directory, files: candidates, missing: false };
  const matched = candidates.filter((name) =>
    entry.filter.some((pattern) => {
      const glob = pattern.replace(/^\*\*\//, "").replace(/\*/g, ".*");
      return new RegExp(`^${glob}$`).test(name);
    }),
  );
  return { directory, files: matched, missing: false };
}

function checkDuplicateTargets() {
  const configs = ["apps/desktop/electron-builder.yml", "apps/desktop/electron-builder.offline.yml"];
  const owners = new Map();
  for (const config of configs) {
    for (const entry of extraResources(config)) {
      if (!entry.target) {
        fail(`${config}:${entry.line} extraResources entry has no "to:" target`);
        continue;
      }
      const { files, missing } = filesFor(entry);
      if (missing) {
        notes.push(`${config}:${entry.line} skips a source that is not staged yet (${entry.source})`);
      }
      for (const file of files) {
        const destination = `${entry.target}/${file}`;
        const previous = owners.get(destination);
        if (previous && previous.config !== config) {
          fail(
            `${destination} is copied twice: ${previous.config}:${previous.line} and ${config}:${entry.line}. ` +
              `On Windows this fails with EBUSY; keep exactly one owner.`,
          );
        }
        owners.set(destination, { config, line: entry.line });
      }
    }
  }
  notes.push(`packaging plan: ${owners.size} destination files claimed`);
}

function checkVersions() {
  const root = JSON.parse(read("package.json")).version;
  const desktop = JSON.parse(read("apps/desktop/package.json")).version;
  if (root !== desktop) fail(`version mismatch: package.json ${root} vs apps/desktop/package.json ${desktop}`);
  else notes.push(`version: ${root}`);
}

function checkTemplatePins() {
  const expected = JSON.parse(read("config/ci-resources.json")).template_commit;
  if (!expected) {
    fail("config/ci-resources.json has no template_commit");
    return;
  }
  const workflows = readdirSync(join(ROOT, ".github/workflows")).filter((name) => name.endsWith(".yml"));
  let compared = 0;
  for (const name of workflows) {
    const text = read(join(".github/workflows", name));
    const refs = [...text.matchAll(/repository:\s*\S*\/\S*Thesis\S*\s*\n\s*ref:\s*(\S+)/g)].map((match) => match[1]);
    for (const ref of refs) {
      compared += 1;
      if (ref !== expected) {
        fail(`.github/workflows/${name} pins the template at ${ref}, ci-resources.json says ${expected}`);
      }
    }
  }
  notes.push(`template pin: ${expected.slice(0, 7)} across ${compared} workflow checkout(s)`);
}

function checkDocumentFonts() {
  const required = ["FZXiaoBiaoSong-B05S.ttf", "STXingkai.ttf", "STZhongsong.ttf"];
  const directory = join(ROOT, "local-fonts");
  const present = existsSync(directory) ? readdirSync(directory) : [];
  for (const font of required) {
    if (!present.includes(font)) {
      const message = `local-fonts/${font} is missing; scripts/stage_document_fonts.py must stage it before packaging`;
      if (allowMissingFonts) notes.push(`${message} (ignored: fonts are staged during packaging)`);
      else fail(message);
    }
  }
  notes.push(`document fonts: ${required.length} required`);
}

checkDuplicateTargets();
checkVersions();
checkTemplatePins();
checkDocumentFonts();

for (const note of notes) console.log(`  ${note}`);
if (problems.length > 0) {
  console.error("\nPackaging plan is not safe to build:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("Packaging plan OK.");
