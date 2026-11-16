// Use real public 0.1.14 and candidate installers, with synthetic task-book content only.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

assert.equal(process.platform,'win32')
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const output=path.join(root,'tmp/windows-failure-verification')
await mkdir(output,{recursive:false})
const require=createRequire(path.join(root,'apps/desktop/package.json'))
const builder=createRequire(require.resolve('electron-builder'))
const {extractFile}=createRequire(builder.resolve('app-builder-lib'))('@electron/asar')
const python=path.join(root,'.venv/Scripts/python.exe')
const endpoint=JSON.parse(await readFile(path.join(root,'config/remote-services.production.json'),'utf8')).diagnostic_endpoint
const fixture=JSON.parse(await readFile(path.join(root,'backend/tests/fixtures/windows-task-book-regression.json'),'utf8'))
const inputConfig=JSON.parse(await readFile(path.join(root,'config/windows-regression.json'),'utf8'))
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const report={commit:process.env.GITHUB_SHA,fixture:'synthetic, source shape retained; no original text',
  original_report_id:'d67e88f0-497c-4f8d-a6e6-00ea96959d1f',
  original_archive_sha256:'458b8ecc2107f0c09dde906dca4a3c07a0cf6312aa09223f64322fe1518b0169',
  receiver:endpoint,maintenance_cloud_readback_verified:false,scenarios:[],diagnostics:[]}
const checkpoint=()=>writeFile(path.join(output,'verification.json'),JSON.stringify(report,null,2))
async function loadBundle(bundle,label){
 const resources=path.join(path.resolve(bundle),'resources'),modules=path.join(output,label+'-modules')
 await mkdir(modules);await writeFile(path.join(modules,'package.json'),'{"type":"module"}')
 const asar=path.join(resources,'app.asar')
 for(const name of ['sidecar-client','offline-runtime','document-fonts','diagnostic-context','full-diagnostics'])
  await writeFile(path.join(modules,name+'.js'),extractFile(asar,`dist-electron/${name}.js`))
 const load=name=>import(pathToFileURL(path.join(modules,name+'.js')).href)
 const {SidecarClient}=await load('sidecar-client'),{FullDiagnostics}=await load('full-diagnostics')
 const {offlineRuntimePaths}=await load('offline-runtime')
 const native=path.join(resources,'sidecar/sztu-docs-backend.exe')
 return {resources,SidecarClient,FullDiagnostics,native,version:JSON.parse(extractFile(asar,'package.json')).version,
  native_sha256:hash(await readFile(native)),runtime:offlineRuntimePaths(path.join(resources,'backend'))}
}
const legacy=await loadBundle(process.argv[2],'legacy'),candidate=await loadBundle(process.argv[3],'candidate')
report.legacy_native_sha256=legacy.native_sha256;report.candidate_native_sha256=candidate.native_sha256
assert.equal(legacy.native_sha256,inputConfig.baseline.native_sha256)
assert.equal(candidate.native_sha256,inputConfig.candidate.native_sha256)
const savedEnv={PATH:process.env.PATH,COMSPEC:process.env.COMSPEC,LOCALAPPDATA:process.env.LOCALAPPDATA,
 USERPROFILE:process.env.USERPROFILE,TEMP:process.env.TEMP,TMP:process.env.TMP}
function restoreEnv(){for(const[k,v]of Object.entries(savedEnv)){if(v===undefined)delete process.env[k];else process.env[k]=v}}
let active
const request=(client,method,params={})=>client.request(method,params,240000,{onDiagnostic:()=>{}})
async function cloudCase(app,workspace,caseId,label,expected,marker){
 const service=new app.FullDiagnostics(workspace,endpoint)
 const selected=await service.get(caseId);assert.ok(selected)
 const archive=path.join(output,label+'.zip');await service.save(caseId,archive)
 const receipt=await service.send(caseId)
 const bytes=await readFile(archive)
 const check=spawnSync(python,['-c',`import json,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 m=json.loads(z.read('manifest.json'));s=json.loads(z.read('stages.json'))
 assert any(x['stage']==sys.argv[2] and x['outcome']=='failure' for x in s)
 if sys.argv[3]:assert any(sys.argv[3].encode() in z.read(n) for n in z.namelist() if n.endswith(('.bin','.log')))
 print(json.dumps({'files':len(z.namelist()),'missing':m['missing']}))`,archive,expected,marker??''],{encoding:'utf8'})
 assert.equal(check.status,0,check.stderr)
 report.diagnostics.push({id:caseId,label,stage:expected,bytes:bytes.length,sha256:hash(bytes),archive:path.basename(archive),
  production_receipt_confirmed:receipt.reportId===caseId,...JSON.parse(check.stdout)})
 await checkpoint();return archive
}
async function runScenario(app,label,reported=false){
 restoreEnv()
 if(reported){delete process.env.COMSPEC;process.env.PATH='%SystemRoot%\\system32;%SystemRoot%'}
 const workspace=path.join(output,label+'-workspace')
 const client=new app.SidecarClient(path.join(app.resources,'backend'),workspace,app.native,{retryRequests:false,appVersion:app.version});active=client
 const call=(m,p)=>request(client,m,p)
 await call('workspace.open',{mode:'persistent',initialize_reference:false})
 const profile=await call('workspace.saveProfile',{profile:{full_name:'合成验收学生',student_number:'CI-REPLAY-001',college:'合成学院',major:'合成专业',
  class_name:'合成班级',advisor_name:'合成指导教师',graduation_cohort:'2026届',thesis_title:['合成任务书故障回归题目']}})
 let document=await call('workspace.createDocument',{document:{profile_id:profile.id,document_type:'task_book',template_version:'regression',schema_version:fixture.schema_version,title:'合成故障结构回归'}})
 document=await call('workspace.saveDraft',{document_id:document.id,content:{metadata:fixture.metadata,sections:fixture.sections},expected_revision:0,reason:'manual'})
 const environment=await call('environment.check')
 assert.ok(Array.isArray(environment.checks))
 for(const id of ['xelatex','pdf_tools','process_tex_packages','core_document_fonts','task_book_engine']) {
  const check=environment.checks.find(c=>c.id===id);assert.ok(check,`Missing environment check ${id}`);assert.notEqual(check.status,'fail',`${label}: ${id} failed before preview`)
 }
 const item={label,app_version:app.version,environment_checks:environment.checks.map(({id,status})=>({id,status}))}
 report.scenarios.push(item);await checkpoint()
 const params={document_id:document.id,request_id:randomUUID(),cancellation_file:path.join(workspace,'cancellations',randomUUID()),app_version:app.version}
 let preview
 try { preview=await call('preview.generate',params) }
 catch(error){
  item.outcome='failure';item.error_code=error.code
  const failure=await new app.FullDiagnostics(workspace).latest();assert.ok(failure)
  item.diagnostic_archive=await cloudCase(app,workspace,failure.reportId,label,'pdf_compile',label==='legacy-reported'?"I can't write on file":undefined)
 }
 if(preview){
  item.outcome='success';item.preview_pages=preview.pages.length
  for(const p of [preview.pdf,...preview.pages]){const b=await readFile(p.absolute_path);assert.equal(hash(b),p.sha256);assert.equal(b.length,p.size_bytes)}
  const tools=path.join(workspace,'diagnostics/full',params.request_id,'tools')
  const first=(await readdir(tools)).sort()[0]
  const invocation=JSON.parse(await readFile(path.join(tools,first,'invocation.json'),'utf8'))
  item.renderer_environment={comspec:invocation.environment.COMSPEC??null,path:invocation.environment.PATH}
  await call('diagnostic.finishPreview',{case_id:params.request_id})
 }
 await client.stop();active=undefined;await checkpoint()
 return {item,workspace,document,profile}
}
try{
 const normal=await runScenario(legacy,'legacy-normal');assert.equal(normal.item.outcome,'success')
 const old=await runScenario(legacy,'legacy-reported',true);assert.equal(old.item.outcome,'failure','Original 0.1.14 failure was not reproduced')
 const fixed=await runScenario(candidate,'candidate-reported',true);assert.equal(fixed.item.outcome,'success','Candidate did not fix the reported environment')
 assert.ok(fixed.item.renderer_environment.comspec)
 assert.ok(!fixed.item.renderer_environment.path.toLowerCase().includes('%systemroot%'))
 report.status='pass'
}catch(error){report.status='failure';report.error={message:error.message,stack:error.stack};throw error}
finally{await active?.stop();restoreEnv();await checkpoint()}
