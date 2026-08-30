# Project instructions

## Scope and evidence

- Preserve unrelated working-tree changes and never commit, publish, or upload without explicit authorization.
- Never run `texclear.sh`, `git clean -X`, `git clean -x`, or another broad cleanup command in this repository or an adjacent template checkout. Ignored files may include the only copy of private references, student materials, or generated evidence. Resolve exact targets with a dry-run and use a recoverable, narrowly scoped operation only after explicit authorization.
- Treat implementation, automated checks, rendered output, target-editor verification, packaging, and release as separate gates.
- Do not commit real student data, signatures, commercial fonts, school seals, credentials, signing materials, databases, exports, or official files whose redistribution rights are unconfirmed.
- Use fixtures with fictional, clearly non-personal data. Logs and screenshots must be sanitized before they are saved as evidence.

## Chinese document rendering gate

These rules apply whenever an agent reads, compares, creates, or reviews a Chinese Word, WPS, PDF, or LaTeX document in this repository.

1. Treat content extraction and visual rendering as separate evidence.
   - Extracted text proves that content exists; it does not prove that layout is correct.
   - A PNG proves visual layout only after the Chinese glyph gate below passes.
2. Before making any visual conclusion about a document containing Chinese text:
   - extract its text and confirm that Chinese characters are present;
   - render the PDF as individual pages at 150 DPI or higher;
   - run the repository CJK render validator on the rendered PDF;
   - inspect at least one Chinese-dense page at 100% scale before making a contact sheet.
3. If extracted text contains Chinese but the glyph gate fails, stop visual review immediately.
   - Report a renderer or font-substitution problem.
   - Do not describe blank areas as missing source content.
   - Do not claim that layout, typography, tables, or pagination were verified.
4. Contact sheets are navigation aids only. Never use a multi-page thumbnail sheet to judge text legibility, font correctness, line spacing, or clipping.
5. When two PDF renderers disagree, treat the render as inconclusive. Re-render with another engine and prefer the target editor (WPS/Word for Office files, Texifier/TeXstudio plus PDF review for LaTeX).
6. Report document status using these separate gates:
   - content extracted;
   - renderer glyph-valid;
   - full-page layout inspected;
   - target-editor verified.
7. For final Office-document acceptance, WPS or Microsoft Word is authoritative. LibreOffice-only output may be used for diagnosis but must not be presented as target-editor verification.

The detailed command guide and failure decision tree belong in `docs/RENDERING_QA.md`. Until that guide and its validator exist in this repository, visual acceptance remains blocked rather than silently skipped.

## Local workbench frontend rules

These rules apply to every frontend prototype, screenshot, and production page in this repository.

1. Use the default `shadcn/ui` design system and its generated theme tokens.
   - Keep the installer-selected default color system, typography, radii, spacing, focus treatment, and light/dark behavior.
   - Do not introduce a custom brand palette, custom font family, gradients, decorative backgrounds, glass effects, bespoke shadows, or ornamental motion.
2. Do not create custom UI primitives or a parallel component library.
   - Use an existing `shadcn/ui` component whenever one covers the interaction.
   - Business components may compose `shadcn/ui` components, but may not establish new visual primitives, styling conventions, or design tokens.
   - Do not copy a third-party component into the repository and restyle it to look custom. If shadcn has no adequate component, document the gap and request explicit approval before adding another frontend dependency or primitive.
3. Do not hand-design pages outside the agreed workbench structure.
   - Use the standard workbench layout: application sidebar, document editor main area, validation/export side panel, and a restrained top action bar.
   - Prefer `Sidebar`, `Resizable`, `Tabs`, `Form`, `Input`, `Textarea`, `Select`, `Button`, `Card`, `Table`, `ScrollArea`, `Alert`, `Badge`, `Dialog`, `Sheet`, `DropdownMenu`, `Progress`, `Separator`, `Tooltip`, and `Sonner` from `shadcn/ui` as applicable.
4. Avoid custom CSS when Tailwind utilities and shadcn theme tokens are sufficient.
   - Do not use arbitrary color values or one-off pixel styling for visual polish.
   - Custom CSS is limited to functional needs that shadcn/Tailwind cannot express, and must be documented next to the rule that requires it.
5. Preserve usability without visual invention.
   - All actions must have visible keyboard focus and useful accessible names.
   - Forms must show field-level validation and actionable error messages.
   - Empty, loading, saving, exporting, failed, and completed states must be explicit.
   - Chinese interface copy should use plain task language such as `保存草稿`, `检查内容`, `导出 Word`, and `在 WPS 中打开`.
6. The frontend must never imply document acceptance from a successful render alone. Keep `结构检查通过`, `中文字形有效`, `逐页版式已检查`, and `Word/WPS 已验证` as separate statuses wherever document quality is shown.

## Architecture and security boundaries

- The Electron renderer must not access Node APIs directly. Preload exposes only a versioned, minimal, validated API.
- Keep `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and `webSecurity: true`.
- Do not assemble shell command strings for Python, XeLaTeX, Word, WPS, or filesystem operations.
- Python sidecar stdout is reserved for versioned JSONL protocol messages; logs go to stderr or a controlled log file.
- Student-facing errors use stable codes and actionable Chinese messages; raw tracebacks remain in sanitized development logs.
- Validate all paths, template manifests, hashes, schemas, IPC messages, and external application requests at their trust boundary.
- Cleanup features must enumerate and preview exact generated targets. They must never interpret Git ignored status as permission to delete a file.
