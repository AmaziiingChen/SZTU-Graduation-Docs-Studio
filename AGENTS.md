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
   - User-approved exception: one brief `canvas-confetti` celebration after an actual successful file export, with reduced-motion support and no input interception. Application chrome is not text-selectable; editing surfaces retain selection and Select All.
   - The only approved semantic color exception is the saved-state badge: match the document-section completion mark with Tailwind `bg-emerald-500` and white icon/text in light and dark modes, and do not reuse it as a brand accent or general decoration.
   - Keep one global UI font stack: Geist first, then explicit system CJK fallbacks for PingFang SC, Microsoft YaHei, and Noto Sans CJK/SC. Do not bundle a Chinese UI font or override font families inside business components.
   - Keep the typography roles narrow: `text-base font-medium` for the workbench title, `text-sm font-medium` for section titles and labels, `text-sm leading-6` for body/editing content, `text-xs text-muted-foreground` for supporting copy, and `font-mono text-xs` only for BibTeX source editing. Do not add a Typography primitive.
   - Start page-level work from an official shadcn Block. The workbench baseline is the official `dashboard-01` composition, not a hand-designed shell.
2. Do not create custom UI primitives or a parallel component library.
   - Use an existing `shadcn/ui` component whenever one covers the interaction.
   - Business components may compose `shadcn/ui` components, but may not establish new visual primitives, styling conventions, or design tokens.
   - Do not copy a third-party component into the repository and restyle it to look custom. If shadcn has no adequate component, document the gap and request explicit approval before adding another frontend dependency or primitive.
3. Do not hand-design pages outside the agreed workbench structure.
   - Preserve the official `dashboard-01` hierarchy: `SidebarProvider`, inset `AppSidebar`, `SidebarInset`, `SiteHeader`, then the business content container.
   - In inset mode, `SidebarProvider` owns the viewport height and clips page-level overflow. `SidebarInset` must flex inside that height so the default shadcn margins remain within the viewport; do not assign `h-svh` to the inset or create a second window scrollbar. The document/editor `ScrollArea` is the normal scrolling surface.
   - Keep Block-derived page composition in `components/workbench/` and default generated primitives in `components/ui/`; never mix business code into a forked primitive.
   - Use the standard workbench layout: application sidebar, a fixed-width document-section navigation column, the document editor main area, and a restrained top action bar. The document-section navigation width is not user-resizable. The top action bar carries content check and one `预览&导出` entry without adding a second toolbar row. Paginated preview and export-format selection reuse one business flow inside the right-side shadcn `Sheet`. Environment checks, quality gates, export status, history, and related explanations reuse one `InspectionPanel`, reached from `检查与导出` at the bottom of `SidebarFooter` and displayed in the main content area.
   - At narrow widths, only the application `Sidebar` may collapse or use its official mobile mechanism. The fixed document-section navigation column must remain visible so section jumping is always available; do not replace it with a `Select`, hide it, or make it independently collapsible. Open the same paginated-preview `Sheet`; do not add a draggable split, a second preview implementation, or a second inspection surface.
   - Never render a preview on every keystroke. The user explicitly clicks `预览&导出`; the application opens the right-side `Sheet` and, when no current valid preview exists, automatically saves and checks the current input before running the same trusted PDF pipeline used by export. Reopening a current valid preview must reuse it without rendering again. Export-format selection stays in the `Sheet` footer and remains disabled until that preview is current.
   - Editing the document, changing the shared profile, or changing the template after preview generation must mark the preview stale. Export remains unavailable until a fresh preview matches both the current input hash and template snapshot hash.
   - A generated PDF preview is internal review evidence only. It must not imply that the corresponding DOCX has passed full-page inspection or Word/WPS verification.
   - Do not import a Block's demo-only charts, tables, sample records, drag-and-drop libraries, or account controls unless the product has the corresponding real workflow.
   - Prefer `Sidebar`, `Tabs`, `Form`, `Input`, `Textarea`, `Select`, `Button`, `Card`, `Table`, `ScrollArea`, `Alert`, `Badge`, `Dialog`, `Sheet`, `DropdownMenu`, `Progress`, `Separator`, `Tooltip`, `Kbd`, and `Sonner` from `shadcn/ui` as applicable.
4. Avoid custom CSS when Tailwind utilities and shadcn theme tokens are sufficient.
   - Do not use arbitrary color values or one-off pixel styling for visual polish.
   - Custom CSS is limited to functional needs that shadcn/Tailwind cannot express, and must be documented next to the rule that requires it.
   - Keep `scripts/check_frontend_design_system.mjs` in the desktop lint path. New fixed palette classes, literal colors, or font-family overrides require an explicit rule change rather than a local suppression.
5. Preserve usability without visual invention.
   - All actions must have visible keyboard focus and useful accessible names.
   - Forms must show field-level validation and actionable error messages.
   - Empty, loading, saving, exporting, failed, and completed states must be explicit.
   - Chinese interface copy should use plain task language such as `保存草稿`, `检查内容`, `导出 Word`, and `在 WPS 中打开`.
6. The frontend must never imply document acceptance from a successful render alone. Keep `结构检查通过`, `中文字形有效`, `逐页版式已检查`, and `Word/WPS 已验证` as separate statuses wherever document quality is shown.
7. Keep structured authoring restricted and contract-backed.
   - The approved rich-content surface is one headless, schema-restricted ProseMirror/Tiptap editing engine inside `components/workbench/`. It is an editing engine only: its toolbar, status, dialogs, buttons, and surrounding layout must continue to compose default shadcn/ui components and theme tokens. Do not add a second visual component library or expose a general-purpose WYSIWYG feature set.
   - Enable only capabilities that the shared document contract and every active renderer support. The initial allowlist is paragraphs, ordered lists, unordered lists, list nesting up to four levels, bold, italic, inline subscript or superscript, undo, and redo. Do not advertise headings, tables, task lists, arbitrary equations, images, links, colors, fonts, arbitrary alignment, or executable HTML as exportable features unless their contracts, renderers, and regression gates are added first.
   - Persist the repository-owned structured content contract as the canonical value. Tiptap/ProseMirror JSON and HTML are adapter or view state only; Word, PDF, and LaTeX renderers must never consume raw HTML, raw Markdown, or editor-private state as their canonical document contract.
   - Treat a thesis directory as structured outline data (`level`, optional `number`, and rich-text `title`), not as whitespace or a body list. Indentation and numbering controls must update semantic fields, and directory input must reject skipped levels instead of guessing hierarchy from leading spaces.
   - Existing Markdown text may be imported through an allowlisted parser for compatibility. Unsupported syntax must produce an actionable error and preserve the last valid structure; it must never be silently dropped.
   - Formatting, list-depth, undo, and redo shortcuts must follow the current Microsoft Word conventions for Windows and macOS. Show platform-specific keys with the default shadcn `Kbd`/`KbdGroup` composition inside each corresponding `Tooltip`; disabled list-depth and history controls must explain why they are unavailable. Shortcut handlers must preserve the mutual exclusion of subscript and superscript and remain covered by interaction tests.
8. Keep autosave scoped to changed data.
   - Track shared student-profile edits and active-document edits independently. Document-only changes must not rewrite an unchanged profile, and profile-only changes must not create a document revision.
   - Advance each persisted edit marker only after its corresponding IPC operation succeeds. If a mixed save partially succeeds, retry only the still-dirty part while keeping the global save state truthful.

## Architecture and security boundaries

- The Electron renderer must not access Node APIs directly. Preload exposes only a versioned, minimal, validated API.
- Keep `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and `webSecurity: true`.
- Do not assemble shell command strings for Python, XeLaTeX, Word, WPS, or filesystem operations.
- Python sidecar stdout is reserved for versioned JSONL protocol messages; logs go to stderr or a controlled log file.
- Student-facing errors use stable codes and actionable Chinese messages; raw tracebacks remain in sanitized development logs.
- Validate all paths, template manifests, hashes, schemas, IPC messages, and external application requests at their trust boundary.
- Keep mutable template development and immutable release trust separate. A user-selected or adjacent local template workspace may be re-read during development only after every allowlisted file and path is validated, fingerprinted, and copied into a private content-addressed snapshot. Render from the snapshot, record its hash/version, and retain fixed-hash verification for committed or released templates.
- Cleanup features must enumerate and preview exact generated targets. They must never interpret Git ignored status as permission to delete a file.

## Telemetry and update boundaries

- Official packaged builds may require disclosed anonymous operational telemetry, but collection must remain purpose-limited and schema-bound. Never transmit profile fields, thesis titles, document content, BibTeX, filenames, absolute paths, template contents, output hashes, free-form error messages, IP addresses, hardware serials, account identifiers, or clipboard data.
- Renderer telemetry input is an exact allowlist of event names and enum-valued attributes. The main process must reject arbitrary event names, unknown fields, raw log strings, and unstable error text before anything enters the local queue.
- Use a random pseudonymous installation identifier that rotates at least every 30 days. Session duration is reported in coarse buckets. The local queue is bounded, stored with private permissions, and never blocks editing or export when the network is unavailable.
- The first packaged launch must clearly disclose the mandatory telemetry and update behavior before transmission begins. There is no hidden collection and no settings control that falsely claims to disable a mandatory release policy.
- COS or another static origin may host only public update manifests and artifacts. Telemetry ingestion requires a separate HTTPS service. Never embed COS SecretId, SecretKey, a server signing key, or another reusable credential in the client.
- Update manifests must be verified with a pinned Ed25519 public key before version or URL fields are trusted. Downloaded artifacts must match the signed platform, architecture, byte length, and SHA-256 before the UI reports them as ready.
- A downloaded artifact is not an installed update. Automatic installation and restart require platform packaging, code signing, rollback, and target-platform acceptance gates; do not imply those gates passed from a successful download.
