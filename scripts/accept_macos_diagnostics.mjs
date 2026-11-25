// Exercise the signed app's document engine and archived client transport.
// Uses only synthetic data and a loopback receiver; never the installed app.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const app = path.resolve(process.argv[2] ?? "")
assert.ok(app.endsWith(".app") && process.argv[2], "Pass the freshly packaged .app")
const resources = path.join(app, "Contents", "Resources")
const localRequire = createRequire(path.join(root, "apps/desktop/package.json"))
const builder = createRequire(localRequire.resolve("electron-builder"))
const { extractFile } = createRequire(builder.resolve("app-builder-lib"))("@electron/asar")
const receiver = localRequire(path.join(root, "cloudbase/functions/sztu-telemetry-ingest/index.js"))
const temp = await mkdtemp(path.join(os.tmpdir(), "sztu-diagnostic-accept-"))
const uploads = new Map()
const server = createServer(receiver.handleRequest({
  databaseConfigured: true,
  persistReport: async report => uploads.set(report.report_id, report),
}))
const outcomes = []
try {
  const modules = path.join(temp, "modules")
  await mkdir(modules)
  await writeFile(path.join(modules, "package.json"), '{"type":"module"}')
  for (const name of ["sidecar-channels", "sidecar-client", "offline-runtime", "document-fonts", "diagnostics", "diagnostic-context"]) {
    const entry = path.join("dist-electron", name + ".js")
    await writeFile(path.join(modules, name + ".js"), extractFile(path.join(resources, "app.asar"), entry))
  }
  const load = name => import(pathToFileURL(path.join(modules, name + ".js")).href)
  const { SidecarClient } = await load("sidecar-client")
  const { DiagnosticService } = await load("diagnostics")
  const { SidecarChannels } = await load("sidecar-channels")
  const appPackage = JSON.parse(extractFile(path.join(resources, "app.asar"), "package.json"))
  const sidecar = path.join(resources, "sidecar", "sztu-docs-backend")
  const signature = spawnSync("codesign", ["--verify", "--deep", "--strict", app], { encoding: "utf8" })
  assert.equal(signature.status, 0, signature.stderr)
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  const originalPath = process.env.PATH ?? ""
  for (const scenario of [
    { name: "compile", tool: "xelatex", stage: "pdf_compile", reason: "tex_input_rejected" },
    { name: "rasterize", tool: "pdftoppm", stage: "preview_rasterize", reason: "tool_nonzero" },
    { name: "pdf-structure", documentType: "proposal", tool: "pdfinfo", stage: "pdf_structure", reason: "tool_nonzero" },
  ]) {
    const workspace = path.join(temp, scenario.name)
    const shim = path.join(workspace, "bin")
    await mkdir(shim, { recursive: true })
    const script = scenario.name === "compile"
      ? "#!/bin/sh\nprintf '%s\\n' 'This is XeTeX, Version 3.14159265' '! Undefined control sequence.' '/Users/private/DO_NOT_UPLOAD' >&2\nexit 23\n"
      : `#!/bin/sh\nif [ "$1" = "-v" ]; then echo "${scenario.tool} version 26.1.0" >&2; exit 0; fi\necho "/Users/private/DO_NOT_UPLOAD" >&2\nexit 23\n`
    await writeFile(path.join(shim, scenario.tool), script, { mode: 0o700 })
    process.env.PATH = shim + path.delimiter + originalPath
    const service = new DiagnosticService({
      userDataPath: workspace, appVersion: appPackage.version, electronVersion: "44.0.0",
      platform: "darwin", arch: process.arch, packaged: true,
      endpoint: `http://127.0.0.1:${server.address().port}/v1/reports`,
    })
    await service.initialize()
    const client = new SidecarClient(path.join(resources, "backend"), workspace, sidecar, { retryRequests: false })
    try {
      const opened = await client.request("workspace.open", { mode: "persistent" })
      const documentType = scenario.documentType ?? "task_book"
      let documents = opened.documents
      if (!documents.length) {
        const profile = await client.request("workspace.saveProfile", { profile: {
          full_name: "合成诊断学生", student_number: "DIAG-001", college: "合成学院", major: "合成专业",
          class_name: "合成班级", advisor_name: "合成指导教师", graduation_cohort: "2026届",
          thesis_title: ["合成诊断题目"] } })
        const fixtureDir = path.join(root, "../Thesis/templates", documentType.replaceAll("_", "-"), "fixtures")
        const fixture = await access(path.join(fixtureDir, "minimal.json")).then(() => "minimal.json", () => "normal.json")
        const data = JSON.parse(await readFile(path.join(fixtureDir, fixture), "utf8"))
        const created = await client.request("workspace.createDocument", { document: { profile_id: profile.profile.id,
          document_type: documentType, template_version: "diagnostic-acceptance", schema_version: data.schema_version,
          title: "合成诊断文档" } })
        await client.request("workspace.saveDraft", { document_id: created.id,
          content: { metadata: data.metadata, sections: data.sections }, expected_revision: 0, reason: "manual" })
        documents = [created]
      }
      const task = documents.find(item => item.document_type === documentType)
      assert.ok(task)
      await client.request("workspace.selectDocument", { document_id: task.id })
      const result = await client.request("document.check", { document_id: task.id })
      assert.ok(result.checks.every(check => check.status === "pass"))
      const requestId = randomUUID()
      await assert.rejects(client.request("preview.generate", {
        document_id: task.id, request_id: requestId, cancellation_file: path.join(workspace, "cancellations", requestId + ".cancel"),
        app_version: appPackage.version,
      }, 120_000, {
        onDiagnostic: ({ outcome, duration_ms, error_code, ...context }) => {
          if (outcome !== "started") service.record("diagnostic.step", outcome, duration_ms, error_code,
            { document_type: documentType, request_id: requestId, ...context })
        },
      }), error => {
        assert.equal(error.code, "RENDER_FAILED")
        assert.ok(error.details?.diagnostic?.trace?.some(frame => frame.module === "exporter.py"))
        return true
      })
      const environment = await client.request("environment.check")
      const summary = service.prepare(environment, { telemetryConfigured: false, updateConfigured: false })
      await service.send(summary.reportId)
      const received = uploads.get(summary.reportId)
      assert.ok(received)
      const operations = received.operations.filter(item => item.context?.request_id === requestId)
      const failed = operations.find(item => item.outcome === "failure" &&
        item.context.stage === scenario.stage && item.context.tool === scenario.tool)
      assert.ok(failed, JSON.stringify(operations))
      assert.equal(failed.context.exit_code, 23)
      assert.equal(failed.context.reason, scenario.reason)
      assert.ok(operations.some(item => item.context.stage === "template" && item.context.template_version))
      if (scenario.name !== "compile") assert.ok(operations.some(item => item.context.stage === "pdf_compile" && item.outcome === "success"))
      assert.ok(!JSON.stringify(received).includes("DO_NOT_UPLOAD"))
      outcomes.push({ scenario: scenario.name, documentType, received: true, reportId: summary.reportId,
        stage: failed.context.stage, tool: failed.context.tool, version: failed.context.tool_version, exit: failed.context.exit_code })
      await service.flush()
    } finally {
      await client.stop()
      process.env.PATH = originalPath
    }
  }
  if (process.argv.includes("--profiles")) {
    const workspace = path.join(temp, "profiles")
    const output = path.join(workspace, "output")
    await mkdir(output, { recursive: true })
    const createClient = role => new SidecarClient(path.join(resources, "backend"), workspace, sidecar, { retryRequests: false, role })
    let channels = new SidecarChannels(createClient("control"), createClient("render"), workspace)
    const call = (method, params) => channels.request(method, params, 120_000)
    try {
      const initial = await call("workspace.open", { mode: "persistent" })
      const task = initial.document
      assert.equal(task.document_type, "task_book")
      const fields = Object.fromEntries(["college", "major", "class_name", "advisor_name", "advisor_title", "graduation_cohort"].map(
        key => [key, initial.profile[key]],
      ))
      const first = await call("workspace.saveProfile", { profile: {
        ...fields, id: initial.profile.id, full_name: "合成学生甲", student_number: "MAC-1001", thesis_title: ["合成甲档案题目"],
      } })
      const second = (await call("workspace.createProfile", { profile: {
        ...fields, full_name: "合成学生乙", student_number: "MAC-1002", thesis_title: ["合成乙档案题目"],
      } })).profile
      const another = await call("workspace.createDocument", { document: {
        profile_id: second.id, document_type: "task_book", template_version: task.template_version,
        schema_version: task.schema_version, title: "乙档案任务书",
      } })
      const students = [
        { profile: first, document: task, body: "合成甲档案正文标记。", title: "合成甲档案题目" },
        { profile: second, document: another, body: "合成乙档案正文标记。", title: "合成乙档案题目" },
      ]
      for (const student of students) {
        const selected = await call("workspace.selectProfile", { profile_id: student.profile.id })
        assert.ok(selected.documents.every(doc => doc.profile_id === student.profile.id))
        const content = structuredClone(task.content)
        content.sections.basic_content_and_requirements = [student.body]
        await call("workspace.saveDraft", {
          document_id: student.document.id, content, expected_revision: student.document.current_revision, reason: "manual",
        })
      }
      await channels.shutdown()
      channels = new SidecarChannels(createClient("control"), createClient("render"), workspace)
      const reopened = await call("workspace.open", { mode: "persistent" })
      assert.equal(reopened.profile.id, second.id)
      assert.equal(reopened.document.id, another.id)
      const cancellationFile = () => path.join(workspace, "cancellations", randomUUID() + ".cancel")
      await assert.rejects(call("preview.generate", {
        document_id: task.id, request_id: randomUUID(), cancellation_file: cancellationFile(), app_version: appPackage.version,
      }), { code: "DOCUMENT_PROFILE_MISMATCH" })
      for (const [index, student] of students.entries()) {
        const other = students[1 - index]
        const selection = await call("workspace.selectProfile", { profile_id: student.profile.id })
        assert.equal(selection.profile_draft.full_name, student.profile.full_name)
        assert.equal(selection.document.id, student.document.id)
        assert.deepEqual(selection.document.content.sections.basic_content_and_requirements, [student.body])
        const preview = await call("preview.generate", {
          document_id: student.document.id, request_id: randomUUID(), cancellation_file: cancellationFile(), app_version: appPackage.version,
        })
        const params = { document_id: student.document.id, preview_id: preview.preview_id, output_directory: output, formats: ["docx", "pdf"] }
        if (index === 0) {
          const service = new DiagnosticService({
            userDataPath: workspace, appVersion: appPackage.version, electronVersion: "44.0.0",
            platform: "darwin", arch: process.arch, packaged: true,
            endpoint: `http://127.0.0.1:${server.address().port}/v1/reports`,
          })
          await service.initialize()
          const requestId = randomUUID()
          const invalidOutput = path.join(output, "DO_NOT_UPLOAD")
          await assert.rejects(channels.request("export.preflight", { ...params, output_directory: invalidOutput }, 120_000,
            ({ outcome, duration_ms, error_code, ...context }) => {
              if (outcome !== "started") service.record("diagnostic.step", outcome, duration_ms, error_code,
                { document_type: "task_book", request_id: requestId, ...context })
            }), { code: "OUTPUT_DIRECTORY_INVALID" })
          const summary = service.prepare(await call("environment.check"), { telemetryConfigured: false, updateConfigured: false })
          await service.send(summary.reportId)
          const received = uploads.get(summary.reportId)
          const failure = received?.operations.find(item => item.context?.request_id === requestId && item.context.stage === "export_input" && item.outcome === "failure")
          assert.equal(failure?.error_code, "OUTPUT_DIRECTORY_INVALID")
          assert.ok(!JSON.stringify(received).includes("DO_NOT_UPLOAD"))
          outcomes.push({ scenario: "export-target", received: true, reportId: summary.reportId,
            stage: failure.context.stage, error: failure.error_code })
          await service.flush()
        }
        const preflight = await call("export.preflight", params)
        assert.equal(preflight.overwrite_required, false)
        await call("export.run", {
          ...params, request_id: randomUUID(), preflight_token: preflight.preflight_token, overwrite_confirmed: false,
          cancellation_file: cancellationFile(), app_version: appPackage.version,
        })
        for (const target of preflight.targets) {
          const extracted = target.format === "docx"
            ? spawnSync("/usr/bin/unzip", ["-p", target.path, "word/document.xml"], { encoding: "utf8" })
            : spawnSync("pdftotext", [target.path, "-"], { encoding: "utf8" })
          assert.equal(extracted.status, 0, extracted.stderr)
          const plain = extracted.stdout.replace(/<[^>]+>|\s+/g, "")
          for (const expected of [student.profile.full_name, student.profile.student_number, student.title, student.body]) {
            assert.ok(plain.includes(expected), `${target.format} missing ${expected}`)
          }
          for (const unexpected of [other.profile.full_name, other.profile.student_number, other.title, other.body]) {
            assert.ok(!plain.includes(unexpected), `${target.format} mixed ${unexpected}`)
          }
        }
        outcomes.push({ scenario: "profile-isolation", student: index + 1, previewPages: preview.pages.length,
          exports: preflight.targets.map(({ format }) => format), restartRestored: true, crossProfileContent: false })
      }
    } finally {
      await channels.shutdown()
    }
  }
  console.log(JSON.stringify({ source: "signed-macos-app", receiver: "local", results: outcomes }, null, 2))
} finally {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await rm(temp, { recursive: true, force: true })
}
