import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const template = path.resolve(root, "../Thesis")
if (!existsSync(path.join(template, "templates/thesis/spec/artifact.md"))) {
  throw new Error("配套 Thesis 工作树不存在，请先创建同级模板工作树。")
}
const env = {
  ...process.env,
  SZTU_DOCS_DEV_PORT: "5174",
  SZTU_DOCS_DEV_DATA_DIR: path.join(root, "user-data/thesis-workbench"),
  SZTU_DOCS_PROPOSAL_ENGINE_DIR: template,
  SZTU_DOCS_TASK_BOOK_ENGINE_DIR: template,
  SZTU_DOCS_MIDTERM_ENGINE_DIR: template,
  SZTU_DOCS_THESIS_ENGINE_DIR: template,
  SZTU_DOCS_ADVISOR_REVIEW_ENGINE_DIR: template,
  SZTU_DOCS_REVIEWER_REVIEW_ENGINE_DIR: template,
  SZTU_DOCS_DEFENSE_RECORD_ENGINE_DIR: template,
  SZTU_DOCS_GRADE_ASSESSMENT_ENGINE_DIR: template,
}
console.log(JSON.stringify({ template, dataDirectory: env.SZTU_DOCS_DEV_DATA_DIR, url: "http://127.0.0.1:5174" }, null, 2))
if (!process.argv.includes("--check")) {
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
  const build = spawnSync(pnpm, ["--filter", "@sztu-docs/desktop", "build:electron"], { cwd: root, env, stdio: "inherit" })
  if (build.status !== 0) process.exit(build.status ?? 1)
  const child = spawn(pnpm, ["exec", "concurrently", "-k", "-s", "first", "vite --host 127.0.0.1 --port 5174", "wait-on tcp:127.0.0.1:5174 && electron ."], { cwd: path.join(root, "apps/desktop"), env, stdio: "inherit" })
  child.on("error", error => { console.error(error.message); process.exitCode = 1 })
  child.on("exit", code => { process.exitCode = code ?? 1 })
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal))
}
