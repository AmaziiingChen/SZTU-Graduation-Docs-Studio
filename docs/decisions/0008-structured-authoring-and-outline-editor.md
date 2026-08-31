# 0008 — Structured authoring and outline editing

## Status

Accepted on 2026-08-30.

## Context

The workbench originally used shadcn `Textarea` fields plus a restricted Markdown parser. That path cannot represent unordered lists, nested list levels, or a directory hierarchy without relying on punctuation or whitespace. The directory contract already stores explicit outline items, while the body contract stores paragraphs and list blocks. Treating both as plain text caused the renderer to discard unsupported structures and made the editing surface diverge from Word, PDF, and LaTeX output.

The user approved implementation of a Word-like structured editing experience while retaining the default shadcn workbench and local-first export pipeline.

## Decision

1. Repository-owned structured JSON remains the canonical content value for persistence, checking, preview, and export.
2. A single headless ProseMirror/Tiptap engine may be used as the restricted body editing surface. It may expose only contract-backed paragraphs, ordered and unordered lists, four nesting levels, bold, italic, subscript, superscript, undo, and redo.
3. All visible controls and surrounding layout continue to use default shadcn/ui components and theme tokens. Tiptap or third-party visual component kits are not used.
4. Directory editing uses the existing outline-item contract and a dedicated outline mode. `level` is authoritative; numbering is display data and whitespace is never hierarchy.
5. The right paginated PDF preview remains explicit and click-generated. Editing structured content marks it stale; editor rendering is not final layout acceptance.
6. Legacy Markdown is a compatibility import format only. The adapter parses an allowlisted structured subset; if unsupported block syntax is present, it preserves the complete source verbatim as editable plain text rather than silently removing content.
7. Formatting, list-depth, undo, and redo shortcuts follow the current Microsoft Word conventions and use `Mod` so Windows maps to Ctrl and macOS maps to Command. Toolbar tooltips show platform-specific shortcuts with the default shadcn `Kbd` and `KbdGroup`, and disabled list-depth or history controls explain why they are unavailable. Subscript and superscript remain mutually exclusive whether invoked by mouse or keyboard.

## Consequences

- Common schemas and all Word/LaTeX renderers must support a feature before its toolbar control is enabled.
- Existing string drafts need a deterministic compatibility adapter and regression fixtures, including unsupported-syntax preservation cases.
- Chinese IME composition, selection preservation, list keymaps, Tab escape, autosave, and Word/WPS paste require dedicated interaction tests.
- A successful editor render or PDF preview does not establish Word/WPS acceptance.
