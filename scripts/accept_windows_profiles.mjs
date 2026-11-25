// Exercise the shipped Windows modules with synthetic data in a separate directory.
import assert from "node:assert/strict"
import { spawnSync, execFile } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile, access, copyFile, cp, readdir } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"

assert.equal(process.platform, "win32")
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const bundle = path.resolve(process.argv[2] ?? "release/offline/win-unpacked")
const rootPackage = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
const expectedVersion = process.env.SZTU_ACCEPT_APP_VERSION || rootPackage.version
const output = path.resolve(process.argv[3] ?? `tmp/windows-profiles-acceptance-${expectedVersion}`)
assert.ok(output.startsWith(path.join(root, "tmp") + path.sep))
assert.equal(
  await access(output).then(
    () => true,
    () => false
  ),
  false,
  "Use a fresh evidence directory"
)
await mkdir(output, { recursive: true })
const localRequire = createRequire(path.join(root, "apps/desktop/package.json"))
const builderRequire = createRequire(localRequire.resolve("electron-builder"))
const { extractFile } = createRequire(builderRequire.resolve("app-builder-lib"))("@electron/asar")
const python = path.join(root, ".venv/Scripts/python.exe")
const execute = promisify(execFile)

async function loadModules(resources, name, entries) {
  const directory = path.join(output, name)
  await mkdir(directory)
  await writeFile(path.join(directory, "package.json"), '{"type":"module"}')
  for (const entry of entries) {
    await writeFile(
      path.join(directory, `${entry}.js`),
      extractFile(path.join(resources, "app.asar"), `dist-electron/${entry}.js`)
    )
  }
  return (name) => import(pathToFileURL(path.join(directory, `${name}.js`)).href)
}

function pythonJson(program, ...args) {
  const result = spawnSync(python, ["-c", program, ...args], {
    encoding: "utf8",
    windowsHide: true
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

const resources = path.join(bundle, "resources")
const version = JSON.parse(extractFile(path.join(resources, "app.asar"), "package.json")).version
assert.equal(version, expectedVersion)
const load = await loadModules(resources, "modules", [
  "sidecar-client",
  "sidecar-channels",
  "offline-runtime",
  "document-fonts",
  "diagnostic-context",
  "full-diagnostics"
])
const { SidecarClient } = await load("sidecar-client")
const { SidecarChannels } = await load("sidecar-channels")
const { FullDiagnostics } = await load("full-diagnostics")
const { offlineRuntimePaths } = await load("offline-runtime")
const runtime = offlineRuntimePaths(path.join(resources, "backend"))
const data = path.join(output, "synthetic-upgrade-workspace")

const previousResources = "C:/Program/SZTU-Docs-Studio/resources"
let firstProfile
let firstDocument
const legacyOption = process.argv.indexOf("--legacy-workspace")
if (legacyOption >= 0) {
  const legacy = path.resolve(process.argv[legacyOption + 1])
  assert.ok(legacy.startsWith(path.join(root, "tmp") + path.sep))
  const backup = (await readdir(path.join(legacy, "backups"))).find(
    (name) => name.startsWith("workspace-before-v6-to-v7-") && name.endsWith(".sqlite3")
  )
  assert.ok(backup, "The synthetic 0.1.13 workspace must include its pre-migration backup")
  await mkdir(data)
  await copyFile(path.join(legacy, "backups", backup), path.join(data, "workspace.sqlite3"))
  await cp(path.join(legacy, "document-assets"), path.join(data, "document-assets"), {
    recursive: true,
    errorOnExist: true,
    force: false
  })
  const saved = pythonJson(
    "import sqlite3,json,sys; c=sqlite3.connect(sys.argv[1]); c.row_factory=sqlite3.Row; print(json.dumps({'profile':dict(c.execute('select * from student_profiles').fetchone()),'document':dict(c.execute(\"select * from documents where document_type='task_book'\").fetchone())}))",
    path.join(data, "workspace.sqlite3")
  )
  firstProfile = saved.profile
  firstDocument = saved.document
} else {
  const previousVersion = process.env.SZTU_ACCEPT_PREVIOUS_VERSION || "0.1.13"
  assert.equal(
    JSON.parse(extractFile(path.join(previousResources, "app.asar"), "package.json")).version,
    previousVersion
  )
  const loadPrevious = await loadModules(previousResources, "previous-modules", [
    "sidecar-client",
    "offline-runtime",
    "document-fonts",
    "diagnostic-context"
  ])
  const PreviousClient = (await loadPrevious("sidecar-client")).SidecarClient
  const old = new PreviousClient(
    path.join(previousResources, "backend"),
    data,
    path.join(previousResources, "sidecar/sztu-docs-backend.exe"),
    { retryRequests: false }
  )
  try {
    const initial = await old.request("workspace.open", {
      mode: "persistent",
    })
    assert.equal(initial.documents.length, 3)
    firstProfile = await old.request("workspace.saveProfile", {
      profile: {
        ...initial.profile,
        full_name: "合成学生甲",
        student_number: "WIN-014-A",
        thesis_title: ["合成甲档案题目"]
      }
    })
    firstDocument = initial.document
    const content = structuredClone(firstDocument.content)
    content.sections.basic_content_and_requirements = ["合成甲档案正文标记。"]
    await old.request("workspace.saveDraft", {
      document_id: firstDocument.id,
      content,
      expected_revision: firstDocument.current_revision,
      reason: "manual"
    })
  } finally {
    await old.stop()
  }
}
const previousSchema = pythonJson(
  "import sqlite3,json,sys; c=sqlite3.connect(sys.argv[1]); print(json.dumps(c.execute('pragma user_version').fetchone()[0]))",
  path.join(data, "workspace.sqlite3")
)
assert.equal(previousSchema, 6)

const createClient = (role) =>
  new SidecarClient(
    path.join(resources, "backend"),
    data,
    path.join(resources, "sidecar/sztu-docs-backend.exe"),
    { retryRequests: false, role, appVersion: version }
  )
let channels = new SidecarChannels(createClient("control"), createClient("render"), data)
// As in the desktop entry point, an observer enables transport diagnostic capture.
const call = (method, params) =>
  channels.request(method, params, 180_000, () => {})
const results = { version, previousVersion: "0.1.13", previousSchema, profiles: [] }
try {
  const migrated = await call("workspace.open", { mode: "persistent" })
  assert.equal(migrated.profile.id, firstProfile.id)
  assert.equal(migrated.documents.length, 3)
  assert.deepEqual(migrated.document.content.sections.basic_content_and_requirements, [
    "合成甲档案正文标记。"
  ])
  results.schema = pythonJson(
    "import sqlite3,json,sys; c=sqlite3.connect(sys.argv[1]); print(json.dumps(c.execute('pragma user_version').fetchone()[0]))",
    path.join(data, "workspace.sqlite3")
  )
  assert.equal(results.schema, 7)
  firstDocument = migrated.document
  const secondProfile = (
    await call("workspace.createProfile", {
      profile: {
        ...Object.fromEntries(
          [
            "college",
            "major",
            "class_name",
            "advisor_name",
            "advisor_title",
            "graduation_cohort"
          ].map((key) => [key, firstProfile[key]])
        ),
        full_name: "合成学生乙",
        student_number: "WIN-014-B",
        thesis_title: ["合成乙档案题目"]
      }
    })
  ).profile
  const secondDocument = await call("workspace.createDocument", {
    document: {
      profile_id: secondProfile.id,
      document_type: "task_book",
      template_version: firstDocument.template_version,
      schema_version: firstDocument.schema_version,
      title: "合成乙任务书"
    }
  })
  const students = [
    {
      profile: firstProfile,
      document: firstDocument,
      title: "合成甲档案题目",
      body: "合成甲档案正文标记。"
    },
    {
      profile: secondProfile,
      document: secondDocument,
      title: "合成乙档案题目",
      body: "合成乙档案正文标记。"
    }
  ]
  for (const student of students) {
    await call("workspace.selectProfile", { profile_id: student.profile.id })
    const selected = await call("workspace.selectDocument", { document_id: student.document.id })
    const content = structuredClone(firstDocument.content)
    content.sections.basic_content_and_requirements = [student.body]
    await call("workspace.saveDraft", {
      document_id: student.document.id,
      content,
      expected_revision: selected.document.current_revision,
      reason: "manual"
    })
  }
  await channels.shutdown()
  channels = new SidecarChannels(createClient("control"), createClient("render"), data)
  const reopened = await call("workspace.open", { mode: "persistent" })
  assert.equal(reopened.profile.id, secondProfile.id)
  assert.equal(reopened.document.id, secondDocument.id)
  const cancellation = () => path.join(data, "cancellations", `${randomUUID()}.cancel`)
  await assert.rejects(
    call("preview.generate", {
      document_id: firstDocument.id,
      request_id: randomUUID(),
      cancellation_file: cancellation(),
      app_version: version
    }),
    { code: "DOCUMENT_PROFILE_MISMATCH" }
  )

  for (const [index, student] of students.entries()) {
    const other = students[1 - index]
    const selection = await call("workspace.selectProfile", { profile_id: student.profile.id })
    assert.equal(selection.profile_draft.full_name, student.profile.full_name)
    await call("workspace.selectDocument", { document_id: student.document.id })
    const preview = await call("preview.generate", {
      document_id: student.document.id,
      request_id: randomUUID(),
      cancellation_file: cancellation(),
      app_version: version
    })
    const target = path.join(output, `student-${index + 1}`)
    await mkdir(target)
    const params = {
      document_id: student.document.id,
      preview_id: preview.preview_id,
      output_directory: target,
      formats: ["docx", "pdf"]
    }
    const preflight = await call("export.preflight", params)
    await call("export.run", {
      ...params,
      request_id: randomUUID(),
      preflight_token: preflight.preflight_token,
      overwrite_confirmed: false,
      cancellation_file: cancellation(),
      app_version: version
    })
    for (const artifact of preflight.targets) {
      let text
      if (artifact.format === "docx") {
        text = pythonJson(
          "import zipfile,json,sys; print(json.dumps(zipfile.ZipFile(sys.argv[1]).read('word/document.xml').decode('utf-8')))",
          artifact.path
        )
      } else {
        const extracted = spawnSync(path.join(runtime[1], "pdftotext.exe"), [artifact.path, "-"], {
          encoding: "utf8",
          windowsHide: true
        })
        assert.equal(extracted.status, 0, extracted.stderr)
        text = extracted.stdout
      }
      const plain = text.replace(/<[^>]+>|\s+/g, "")
      for (const expected of [
        student.profile.full_name,
        student.profile.student_number,
        student.title,
        student.body
      ])
        assert.ok(plain.includes(expected), `${artifact.format} missing ${expected}`)
      for (const unexpected of [
        other.profile.full_name,
        other.profile.student_number,
        other.title,
        other.body
      ])
        assert.ok(!plain.includes(unexpected), `${artifact.format} mixed profiles`)
    }
    results.profiles.push({
      student: index + 1,
      previewPages: preview.pages.length,
      formats: preflight.targets.map((item) => item.format),
      restartRestored: true,
      crossProfileContent: false
    })
    console.log(`Student ${index + 1}: preview, PDF and Word content verified`)

    if (index === 0) {
      let caseId
      await assert.rejects(
        call("export.preflight", {
          ...params,
          output_directory: path.join(target, "synthetic-missing-directory")
        }),
        (error) => {
          assert.equal(error.code, "OUTPUT_DIRECTORY_INVALID")
          caseId = error.details?.diagnostic_case_id ?? error.diagnosticCaseId
          assert.ok(caseId)
          return true
        }
      )
      const config = JSON.parse(
        await readFile(path.join(resources, "remote-services.json"), "utf8")
      )
      const diagnostics = new FullDiagnostics(data, config.diagnostic_endpoint)
      const item = await diagnostics.get(caseId)
      assert.ok(item.files.some((file) => file.name === "request.json"))
      assert.ok(item.files.some((file) => file.name === "response.json"))
      const saved = path.join(output, "synthetic-full-diagnostic.zip")
      await diagnostics.save(caseId, saved)
      const entries = pythonJson(
        "import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps(z.namelist()))",
        saved
      )
      results.fullDiagnostics = {
        reportId: caseId,
        fileCount: entries.length,
        sizeBytes: item.sizeBytes,
        archiveValid: true
      }
      if (process.argv.includes("--send")) {
        await diagnostics.send(caseId)
        const cli = path.join(process.env.APPDATA, "npm/node_modules/@cloudbase/cli/bin/tcb")
        const sql = `SELECT archive_base64, sha256 FROM public.full_diagnostic_reports WHERE report_id = '${caseId}'::uuid`
        const { stdout } = await execute(
          process.execPath,
          [cli, "db", "execute", "-e", "amazingapp-d5giro9ac73398410", "--sql", sql, "--json"],
          { windowsHide: true, maxBuffer: 20 * 1024 * 1024 }
        )
        const response = JSON.parse(stdout.slice(stdout.indexOf("{")))
        assert.equal(response.data.Rows.length, 1)
        const [encoded, checksum] = JSON.parse(response.data.Rows[0])
        const received = Buffer.from(encoded, "base64")
        assert.equal(createHash("sha256").update(received).digest("hex"), checksum)
        assert.deepEqual(received, await readFile(saved))
        await writeFile(path.join(output, "cloud-readback.zip"), received)
        results.fullDiagnostics.cloudReceiptAndReadback = true
        console.log(`Synthetic full diagnostic uploaded and read back: ${caseId}`)
      }
    }
  }
  await call("workspace.selectProfile", { profile_id: firstProfile.id })
  await call("workspace.deleteProfile", { profile_id: firstProfile.id })
  const restored = await call("workspace.restoreProfile", { profile_id: firstProfile.id })
  assert.ok(
    restored.documents.some(
      (document) => document.id === firstDocument.id && document.profile_id === firstProfile.id
    )
  )
  const second = await call("workspace.selectProfile", { profile_id: secondProfile.id })
  assert.ok(
    second.documents.some(
      (document) => document.id === secondDocument.id && document.profile_id === secondProfile.id
    )
  )
  results.deleteRestorePreservesOwnership = true
  await writeFile(path.join(output, "acceptance.json"), JSON.stringify(results, null, 2) + "\n")
  console.log(JSON.stringify(results, null, 2))
} finally {
  await channels.shutdown()
}
