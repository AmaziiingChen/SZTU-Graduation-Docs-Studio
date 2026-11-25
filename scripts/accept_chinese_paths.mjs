// Exercise the source backend with every path that a Chinese Windows profile
// produces: a Chinese data directory, Chinese export folders, and (through the
// workflow's %TEMP% override) a Chinese temporary directory.
//
// This guards the bug class reported in full_diagnostic_reports ca017910:
// poppler opens its own output files with a plain fopen(), so writing bbox HTML
// or page rasters under C:\Users\<中文姓名>\AppData\Local\Temp fails even
// though reading the PDF from that same path works.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const template = path.resolve(
  process.env.SZTU_ACCEPT_TEMPLATE_DIR || path.join(root, '..', 'Thesis'),
)
const output = path.resolve(process.argv[2] ?? path.join(root, 'tmp', 'chinese-path-matrix'))
assert.ok(output.startsWith(path.join(root, 'tmp') + path.sep), 'output must stay inside tmp/')

const kinds = ['proposal', 'task_book', 'midterm', 'advisor_review', 'reviewer_review', 'defense_record', 'grade_assessment']
const rootPackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const appVersion = process.env.SZTU_ACCEPT_APP_VERSION || rootPackage.version
const python = process.env.SZTU_ACCEPT_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
const engineEnvironment = Object.fromEntries(
  [...kinds.map(kind => [kind, `SZTU_DOCS_${kind.toUpperCase()}_ENGINE_DIR`])].map(([kind, name]) => [name, template]),
)

// Non-ASCII directories with a space on purpose.
const workspace = path.join(output, '数据 目录')
await mkdir(workspace, { recursive: true })
const report = {
  platform: process.platform,
  arch: process.arch,
  commit: process.env.GITHUB_SHA ?? null,
  version: appVersion,
  temporary_directory: process.env.TEMP ?? process.env.TMPDIR ?? null,
  documents: [],
}
const started = []

class Sidecar {
  constructor() {
    this.child = spawn(python, ['-m', 'sztu_docs_backend'], {
      cwd: root,
      env: {
        ...process.env,
        PYTHONPATH: path.join(root, 'backend', 'src'),
        SZTU_DOCS_DATA_DIR: workspace,
        SZTU_DOCS_APP_VERSION: appVersion,
        ...engineEnvironment,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    started.push(this.child.pid)
    this.pending = new Map()
    this.stderr = ''
    let buffered = ''
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', chunk => {
      buffered += chunk
      for (let index = buffered.indexOf('\n'); index >= 0; index = buffered.indexOf('\n')) {
        const line = buffered.slice(0, index).trim()
        buffered = buffered.slice(index + 1)
        if (!line) continue
        let message
        try {
          message = JSON.parse(line)
        } catch {
          continue
        }
        const waiting = this.pending.get(message.id)
        if (!waiting) continue
        this.pending.delete(message.id)
        clearTimeout(waiting.timer)
        if (message.ok) waiting.resolve(message.result)
        else {
          const error = new Error(message.error?.message ?? 'sidecar error')
          error.code = message.error?.code
          error.details = message.error?.details
          waiting.reject(error)
        }
      }
    })
    this.child.stderr.on('data', chunk => { this.stderr += chunk.toString('utf8') })
    this.child.on('exit', code => {
      for (const waiting of this.pending.values()) {
        clearTimeout(waiting.timer)
        waiting.reject(new Error(`sidecar exited with ${code}`))
      }
      this.pending.clear()
    })
  }

  request(method, params = {}, timeoutMs = 900_000) {
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        const error = new Error(`${method} timed out after ${timeoutMs} ms`)
        error.code = 'REQUEST_TIMEOUT'
        reject(error)
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.child.stdin.write(`${JSON.stringify({ protocol: "1.0", id, method, params })}\n`)
    })
  }

  stop() {
    this.child.stdin.end()
    return new Promise(resolve => {
      if (this.child.exitCode !== null) return resolve()
      const timer = setTimeout(() => { this.child.kill(); resolve() }, 10_000)
      this.child.once('exit', () => { clearTimeout(timer); resolve() })
    })
  }
}

const client = new Sidecar()
let failure = null
try {
  const initial = await client.request('workspace.open', { mode: 'persistent' })
  const profile = await client.request('workspace.saveProfile', {
    profile: {
      ...initial.profile,
      full_name: '中文路径验收学生',
      student_number: 'CI-CJK-001',
      college: '合成学院',
      major: '合成专业',
      class_name: '合成班级',
      advisor_name: '合成指导教师',
      advisor_title: '合成职称',
      graduation_cohort: '2026届',
      thesis_title: ['中文路径验收题目'],
    },
  })
  for (const kind of kinds) {
    const directory = path.join(template, 'templates', kind.replaceAll('_', '-'), 'fixtures')
    const fixture = await access(path.join(directory, 'minimal.json')).then(() => 'minimal.json', () => 'normal.json')
    const data = JSON.parse(await readFile(path.join(directory, fixture), 'utf8'))
    let document = await client.request('workspace.createDocument', {
      document: { profile_id: profile.id, document_type: kind, template_version: 'ci-chinese-path', schema_version: data.schema_version, title: `中文路径-${kind}` },
    })
    document = await client.request('workspace.saveDraft', {
      document_id: document.id,
      content: { metadata: data.metadata, sections: data.sections },
      expected_revision: 0,
      reason: 'manual',
    })
    const cancellation = () => path.join(workspace, 'cancellations', randomUUID())
    const preview = await client.request('preview.generate', {
      document_id: document.id,
      request_id: randomUUID(),
      cancellation_file: cancellation(),
      app_version: appVersion,
    })
    assert.ok(Array.isArray(preview.pages) && preview.pages.length > 0, `${kind}: preview rendered no pages`)
    for (const page of [preview.pdf, ...preview.pages]) {
      await access(page.absolute_path)
      assert.ok(page.absolute_path.includes('数据 目录'), `${kind}: preview cache left the Chinese workspace`)
    }
    const target = path.join(output, '导出 目录', kind)
    await mkdir(target, { recursive: true })
    const params = { document_id: document.id, preview_id: preview.preview_id, output_directory: target, formats: ['docx', 'pdf'] }
    const preflight = await client.request('export.preflight', params)
    assert.equal(preflight.ready, true, `${kind}: preflight blocked with ${JSON.stringify(preflight.blocking_codes ?? [])}`)
    await client.request('export.run', {
      ...params,
      request_id: randomUUID(),
      preflight_token: preflight.preflight_token,
      overwrite_confirmed: false,
      cancellation_file: cancellation(),
      app_version: appVersion,
    })
    const pdf = preflight.targets.find(item => item.path.toLowerCase().endsWith('.pdf'))
    assert.ok(pdf, `${kind}: preflight listed no PDF target`)
    await access(pdf.path)
    // The production gate now runs inside export.run; run the CLI again to keep a
    // readable log and to prove the gate works from a Chinese working directory.
    const gate = spawnSync(python, [path.join(root, 'scripts', 'validate_cjk_render.py'), pdf.path, '--dpi', '150', '--min-cjk-words', '2'], {
      encoding: 'utf8',
      cwd: target,
    })
    await writeFile(path.join(target, 'glyph-gate.txt'), (gate.stdout ?? '') + (gate.stderr ?? ''))
    assert.equal(gate.status, 0, `${kind}: glyph gate failed\n${gate.stdout ?? ''}${gate.stderr ?? ''}`)
    report.documents.push({ kind, preview_pages: preview.pages.length, pdf: pdf.path, glyph_gate: 'pass' })
    await writeFile(path.join(output, 'chinese-paths.json'), JSON.stringify(report, null, 2))
    console.log(`PASS ${kind}: preview ${preview.pages.length} pages, docx+pdf exported, glyph gate passed`)
  }
} catch (error) {
  failure = error
  report.error = { code: error.code ?? null, message: error.message, details: error.details ?? null }
  console.error(`FAIL: ${error.code ? `[${error.code}] ` : ''}${error.message}`)
  if (error.details) console.error(JSON.stringify(error.details, null, 2).slice(-4_000))
} finally {
  await client.stop()
  report.status = failure ? 'failure' : 'pass'
  report.sidecar_stderr = client.stderr.slice(-8_000)
  await writeFile(path.join(output, 'chinese-paths.json'), JSON.stringify(report, null, 2))
}
if (report.sidecar_stderr) console.error(report.sidecar_stderr)
if (failure) process.exitCode = 1
else console.log(`PASS: ${report.documents.length} documents exported from Chinese paths on ${process.platform}`)
