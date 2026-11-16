// Run the installer-owned modules and native engine with synthetic input only.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { access, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bundle = path.resolve(process.argv[2])
const output = path.resolve(process.argv[3])
assert.ok(output.startsWith(path.join(root, 'tmp') + path.sep))
await mkdir(path.dirname(output), { recursive: true })
await mkdir(output, { recursive: false })
const resources = path.join(bundle, ...(process.platform === 'darwin' ? ['Contents', 'Resources'] : ['resources']))
const require = createRequire(path.join(root, 'apps/desktop/package.json'))
const builder = createRequire(require.resolve('electron-builder'))
const { extractFile } = createRequire(builder.resolve('app-builder-lib'))('@electron/asar')
const modules = path.join(output, 'modules')
await mkdir(modules)
await writeFile(path.join(modules, 'package.json'), '{"type":"module"}')
for (const name of ['sidecar-client', 'offline-runtime', 'document-fonts', 'diagnostic-context', 'full-diagnostics']) {
  await writeFile(path.join(modules, name + '.js'), extractFile(path.join(resources, 'app.asar'), `dist-electron/${name}.js`))
}
const load = name => import(pathToFileURL(path.join(modules, name + '.js')).href)
const { SidecarClient } = await load('sidecar-client')
const { FullDiagnostics } = await load('full-diagnostics')
const { offlineRuntimePaths } = await load('offline-runtime')
const native = path.join(resources, 'sidecar', 'sztu-docs-backend' + (process.platform === 'win32' ? '.exe' : ''))
const version = JSON.parse(extractFile(path.join(resources, 'app.asar'), 'package.json')).version
const runtime = offlineRuntimePaths(path.join(resources, 'backend'))
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const report = { commit: process.env.GITHUB_SHA, version, platform: process.platform, arch: process.arch,
  native_sha256: createHash('sha256').update(await readFile(native)).digest('hex'),
  source: 'installed-package', receiver: 'loopback-production-handler', production_cloud_verified: false,
  target_editor_verified: false, documents: [], diagnostics: [] }
const received = new Map()
const receiver = require(path.join(root, 'cloudbase/functions/sztu-telemetry-ingest/index.js'))
const server = createServer(receiver.handleRequest({ databaseConfigured: true,
  persistFull: async (id, bytes, checksum) => received.set(id, { bytes: Buffer.from(bytes), checksum }) }))
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const workspace = path.join(output, 'synthetic-workspace')
let client
const start = () => client = new SidecarClient(path.join(resources, 'backend'), workspace, native,
  { retryRequests: false, appVersion: version })
// Production main attaches an observer, which also enables per-request raw capture.
const call = (method, params = {}) => client.request(method, params, 240_000, { onDiagnostic: () => {} })
const checkpoint = () => writeFile(path.join(output, 'acceptance.json'), JSON.stringify(report, null, 2))
const previewParams = document => ({ document_id: document.id, request_id: randomUUID(),
  cancellation_file: path.join(workspace, 'cancellations', randomUUID()), app_version: version })
async function verifiedPreview(document) {
  const params = previewParams(document)
  const result = await call('preview.generate', params)
  assert.ok(result.pages.length > 0)
  for (const item of [result.pdf, ...result.pages]) {
    const relative = path.relative(workspace, item.absolute_path)
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative))
    const bytes = await readFile(item.absolute_path)
    assert.equal(bytes.length, item.size_bytes)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256)
  }
  await call('diagnostic.finishPreview', { case_id: params.request_id })
  return result
}
async function checkCase(caseId, expected, marker) {
  const service = new FullDiagnostics(workspace, `http://127.0.0.1:${server.address().port}/api/diagnostics/v1/reports`)
  const item = await service.get(caseId)
  assert.ok(item)
  const archive = path.join(output, caseId + '.zip')
  await service.save(caseId, archive)
  await service.send(caseId)
  const bytes = await readFile(archive)
  assert.deepEqual(received.get(caseId)?.bytes, bytes)
  assert.equal(received.get(caseId).checksum, createHash('sha256').update(bytes).digest('hex'))
  const check = spawnSync(python, ['-c', `import json,zipfile,sys
with zipfile.ZipFile(sys.argv[1]) as z:
 s=json.loads(z.read('stages.json')); assert any(x['stage']==sys.argv[2] and x['outcome']=='failure' for x in s)
 assert json.loads(z.read('runtime.json'))['frozen'] is True
 if sys.argv[3]: assert any(sys.argv[3].encode() in z.read(n) for n in z.namelist() if n.endswith('.bin'))
 print(json.dumps({'files':len(z.namelist()),'stage':sys.argv[2]}))`, archive, expected, marker ?? ''], { encoding: 'utf8' })
  assert.equal(check.status, 0, check.stderr)
  report.diagnostics.push({ id: caseId, ...JSON.parse(check.stdout), bytes: bytes.length,
    sha256: received.get(caseId).checksum, loopback_readback: true })
  await checkpoint()
}
let restoreTool
try {
  // This verifies resources read from the installed EXE or mounted DMG, not the build staging copy.
  const unpacked = process.platform === 'darwin'
    ? path.join(root, 'release/mac-arm64/SZTU文档工作台.app/Contents/Resources/app.asar')
    : path.join(root, 'release/offline/win-unpacked/resources/app.asar')
  assert.deepEqual(await readFile(path.join(resources, 'app.asar')), await readFile(unpacked))
  start()
  const initial = await call('workspace.open', { mode: 'persistent', initialize_reference: false })
  const profile = await call('workspace.saveProfile', { profile: { ...initial.profile,
    full_name: '合成验收学生甲', student_number: 'CI-TEST-A', college: '合成学院', major: '合成专业',
    class_name: '合成班级', advisor_name: '合成指导教师', advisor_title: '合成职称', graduation_cohort: '2026届',
    thesis_title: ['合成持续集成验收题目'] } })
  let task
  for (const kind of ['proposal', 'task_book', 'midterm', 'advisor_review', 'reviewer_review', 'defense_record', 'grade_assessment']) {
    const fixtureDir = path.join(root, '../Thesis/templates', kind.replaceAll('_', '-'), 'fixtures')
    const fixture = await access(path.join(fixtureDir, 'minimal.json')).then(() => 'minimal.json', () => 'normal.json')
    const data = JSON.parse(await readFile(path.join(fixtureDir, fixture), 'utf8'))
    let document = await call('workspace.createDocument', { document: { profile_id: profile.id,
      document_type: kind, template_version: 'ci-acceptance', schema_version: data.schema_version, title: `合成验收-${kind}` } })
    document = await call('workspace.saveDraft', { document_id: document.id,
      content: { metadata: data.metadata, sections: data.sections }, expected_revision: 0, reason: 'manual' })
    const preview = await verifiedPreview(document)
    assert.ok(preview.pages.length > 0)
    const target = path.join(output, 'exports', kind)
    await mkdir(target, { recursive: true })
    const params = { document_id: document.id, preview_id: preview.preview_id,
      output_directory: target, formats: ['docx', 'pdf'] }
    const preflight = await call('export.preflight', params)
    await call('export.run', { ...params, request_id: randomUUID(), preflight_token: preflight.preflight_token,
      overwrite_confirmed: false, cancellation_file: previewParams(document).cancellation_file, app_version: version })
    for (const item of preflight.targets) {
      await access(item.path)
      if (item.format === 'pdf') {
        const qa = spawnSync(python, [path.join(root, 'scripts/validate_cjk_render.py'), item.path,
          '--dpi', '150', '--min-cjk-words', '2'], { encoding: 'utf8',
          env: { ...process.env, PATH: [...runtime, process.env.PATH].join(path.delimiter) } })
        await writeFile(path.join(target, 'glyph-check.txt'), qa.stdout + qa.stderr)
        assert.equal(qa.status, 0, qa.stdout + qa.stderr)
      }
    }
    report.documents.push({ kind, preview_pages: preview.pages.length, export_formats: ['docx', 'pdf'],
      content_extracted: true, renderer_glyph_valid: true, full_page_layout_inspected: false, target_editor_verified: false })
    await checkpoint()
    console.log(`PASS installed ${kind}: preview + PDF + Word`)
    if (kind === 'task_book') task = document
    if (kind === 'proposal') {
      await assert.rejects(call('export.preflight', { ...params, output_directory: path.join(output, 'nonexistent') }),
        error => error.code === 'OUTPUT_DIRECTORY_INVALID')
      await checkCase((await new FullDiagnostics(workspace).latest()).reportId, 'export_input')
    }
  }
  await client.stop()
  if (process.platform === 'win32') {
    // Reproduce the production environment gap without a test harness fixing PATH.
    const oldPath = process.env.PATH, oldComspec = process.env.COMSPEC
    try {
      delete process.env.COMSPEC
      process.env.PATH = '%SystemRoot%\\system32;%SystemRoot%'
      start()
      await call('workspace.open', { mode: 'persistent' })
      await call('workspace.selectProfile', { profile_id: profile.id })
      task = await call('workspace.saveDraft', { document_id: task.id,
        content: { ...task.content, sections: { ...task.content.sections,
          basic_content_and_requirements: ['合成系统路径回归测试。'] } },
        expected_revision: task.current_revision, reason: 'manual' })
      const checked = await verifiedPreview(task)
      assert.ok(checked.pages.length > 0)
      report.windows_environment = { missing_comspec: 'pass', unexpanded_system_path: 'pass',
        native_preview_pages: checked.pages.length }
    } finally {
      await client.stop()
      process.env.PATH = oldPath
      if (oldComspec === undefined) delete process.env.COMSPEC
      else process.env.COMSPEC = oldComspec
    }
    await checkpoint()
  }
  // A native fault tool is used on Windows; a .cmd is not equivalent to a native executable.
  const faultDir = path.join(output, 'fault-tool')
  await mkdir(faultDir)
  if (process.platform === 'win32') {
    const source = path.join(faultDir, 'fault.cs'), exe = path.join(faultDir, 'xelatex.exe')
    await writeFile(source, 'using System; class Tool { static int Main(string[] a) { if(a.Length>0 && a[0]=="--version") {Console.WriteLine("XeTeX version 3.141592653");return 0;} Console.Error.WriteLine("CI_SYNTHETIC_COMPILE_FAILURE"); return 23; }}')
    const compiler = path.join(process.env.SYSTEMROOT, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
    const built = spawnSync(compiler, ['/nologo', `/out:${exe}`, source], { encoding: 'utf8' })
    assert.equal(built.status, 0, built.stdout + built.stderr)
    const actual = path.join(runtime[0], 'xelatex.exe'), saved = actual + '.ci-original'
    await rename(actual, saved)
    restoreTool = async () => { await copyFile(saved, actual); }
    await copyFile(exe, actual)
  } else {
    await writeFile(path.join(faultDir, 'xelatex'), '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "XeTeX version 3.141592653"; exit 0; fi\necho CI_SYNTHETIC_COMPILE_FAILURE >&2\nexit 23\n', { mode: 0o700 })
    const old = process.env.PATH
    process.env.PATH = faultDir + path.delimiter + old
    restoreTool = async () => { process.env.PATH = old }
  }
  start()
  await call('workspace.open', { mode: 'persistent' })
  await call('workspace.selectProfile', { profile_id: profile.id })
  const taskContent = { ...task.content, sections: { ...task.content.sections,
    basic_content_and_requirements: ['合成编译故障测试。'] } }
  task = await call('workspace.saveDraft', { document_id: task.id, content: taskContent,
    expected_revision: task.current_revision, reason: 'manual' })
  await assert.rejects(call('preview.generate', previewParams(task)), error => error.code === 'RENDER_FAILED')
  await checkCase((await new FullDiagnostics(workspace).latest()).reportId, 'pdf_compile', 'CI_SYNTHETIC_COMPILE_FAILURE')
  report.status = 'pass'
} catch (error) {
  report.status = 'failure'
  report.error = { message: error.message, stack: error.stack }
  throw error
} finally {
  await client?.stop()
  if (restoreTool) await restoreTool()
  await checkpoint()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
