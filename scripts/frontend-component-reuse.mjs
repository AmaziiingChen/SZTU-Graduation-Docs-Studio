import { createRequire } from "node:module"

const require = createRequire(new URL("../apps/desktop/package.json", import.meta.url))
const ts = require("typescript")

// This gate catches concrete reuse regressions. User approval for a new component
// still has to be established by the agent/reviewer, as required in AGENTS.md.
export function componentReuseIssues(filePath, source) {
  const tree = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const isPrimitive = /components[\\/]ui[\\/]/.test(filePath)
  const isStructuredEditor = /(?:^|\/)apps\/desktop\/src\/components\/workbench\/structured-content-editor\.tsx$/.test(filePath.replaceAll("\\", "/"))
  const issues = []
  const report = (node, message) => {
    const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1
    issues.push(`${filePath}:${line} ${message}`)
  }
  const visit = node => {
    if (isPrimitive && (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) &&
        /(?:^|\/)workbench(?:\/|$)/.test(node.moduleSpecifier.text)) {
      report(node, "UI primitives must not import or re-export workbench components; reuse a shared lower-level implementation.")
    }
    if (!isPrimitive && (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))) {
      const tag = node.tagName.getText(tree)
      const attributes = node.attributes.properties
      // User-approved editor toolbar glass (2026-10-04). Keep the exception
      // scoped to this existing surface; other business glass stays prohibited.
      const isApprovedGlassToolbar = isStructuredEditor && tag === "div" && attributes.some(attribute =>
        ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === "data-slot" &&
        attribute.initializer && ts.isStringLiteral(attribute.initializer) &&
        attribute.initializer.text === "editor-format-toolbar")
      if (tag === "label") {
        report(node, "Reuse FieldLabel/Label instead of a native business-layer label.")
      }
      if (tag === "button" && attributes.some(attribute =>
        ts.isJsxAttribute(attribute) && ["className", "style"].includes(attribute.name.getText(tree)))) {
        report(node, "Reuse Button or SidebarMenuAction instead of styling a native button. A bare render target remains allowed.")
      }
      for (const attribute of attributes) {
        if (!ts.isJsxAttribute(attribute) || attribute.name.getText(tree) !== "className") continue
        const treatments = [...(attribute.initializer?.getText(tree) ?? "").matchAll(/\b(?:backdrop-blur(?:-[\w\[.\]-]+)?|bg-gradient-to-\w+|bg-linear-to-\w+)\b/g)]
        if (treatments.some(([treatment]) => !(isApprovedGlassToolbar && treatment === "backdrop-blur-md"))) {
          report(attribute, "Reuse the default component surface; business components cannot add glass or gradient treatments.")
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return issues
}
