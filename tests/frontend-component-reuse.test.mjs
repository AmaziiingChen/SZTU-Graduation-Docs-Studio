import assert from "node:assert/strict"
import test from "node:test"
import { componentReuseIssues } from "../scripts/frontend-component-reuse.mjs"

test("rejects business-layer visual primitives while allowing the official render contract", () => {
  const path = "apps/desktop/src/components/workbench/example.tsx"
  assert.equal(componentReuseIssues(path, '<Button render={<button type="button" />} />').length, 0)
  assert.equal(componentReuseIssues(path, '<button className="rounded-md" />').length, 1)
  assert.equal(componentReuseIssues(path, '<button style={{ width: 20 }} />').length, 1)
  assert.equal(componentReuseIssues(path, '<label htmlFor="name">姓名</label>').length, 1)
  assert.equal(componentReuseIssues(path, '<FieldLabel htmlFor="name">姓名</FieldLabel>').length, 0)
})

test("prevents primitive-to-business dependencies without rejecting shared adapters", () => {
  const path = "apps/desktop/src/components/ui/example.tsx"
  assert.equal(componentReuseIssues(path, 'import { X } from "@/components/workbench/x"').length, 1)
  assert.equal(componentReuseIssues(path, 'export { X } from "../workbench/x"').length, 1)
  assert.equal(componentReuseIssues(path, 'import { X } from "@/components/animated-action-icon"').length, 0)
  assert.equal(componentReuseIssues(path, '<label className="text-sm" />').length, 0)
})

test("blocks new business glass treatments but retains upstream primitive effects", () => {
  const source = '<div className="bg-background/70 backdrop-blur-md" />'
  assert.equal(componentReuseIssues("apps/desktop/src/App.tsx", source).length, 1)
  assert.equal(componentReuseIssues("apps/telemetry-admin/src/App.tsx", source).length, 1)
  assert.equal(componentReuseIssues("apps/desktop/src/components/ui/dialog.tsx", source).length, 0)
  assert.equal(componentReuseIssues("apps/desktop/src/App.tsx", 'const sample = `<label>example</label>`').length, 0)
})

test("allows only the user-approved glass on the existing editor format toolbar", () => {
  const path = "apps/desktop/src/components/workbench/structured-content-editor.tsx"
  const source = '<div data-slot="editor-format-toolbar" className="bg-background supports-backdrop-filter:bg-background/70 supports-backdrop-filter:backdrop-blur-md" />'
  assert.equal(componentReuseIssues(path, source).length, 0)
  assert.equal(componentReuseIssues(`/workspace/${path}`, source).length, 0)
  assert.equal(componentReuseIssues(path.replaceAll("/", "\\"), source).length, 0)
  assert.equal(componentReuseIssues(path.replace("structured-content-editor", "other-editor"), source).length, 1)
  assert.equal(componentReuseIssues(path, source.replace('data-slot="editor-format-toolbar"', 'data-slot="editor-body"')).length, 1)
  assert.equal(componentReuseIssues(path, source.replace("backdrop-blur-md", "backdrop-blur-xl")).length, 1)
  assert.equal(componentReuseIssues(path, source.replace("backdrop-blur-md", "backdrop-blur-md bg-linear-to-r")).length, 1)
})
