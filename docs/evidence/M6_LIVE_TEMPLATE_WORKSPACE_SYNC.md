# Live template workspace sync acceptance

Date: 2026-08-30

## Problem

Proposal export stopped with `TEMPLATE_ENGINE_HASH_MISMATCH` because the desktop
workbench still expected hashes from an earlier committed proposal engine while
the local Thesis template project had continued to evolve.

## Implemented boundary

- Development template projects are linked as mutable workspaces.
- Environment checks, preflight, and export re-read the current allowlisted
  files.
- Path traversal, symlink escape, missing dependency, and unsupported selection
  failures stop the sync.
- The current allowlisted files produce a combined SHA-256 and an immutable,
  private, content-addressed snapshot.
- Rendering uses that snapshot, not the mutable source directory.
- Export preflight tokens and receipts retain the snapshot hash.
- Fixed published template packs keep their declared file hashes and still
  reject drift.

## Verification

- Current `/Users/chen/Thesis` proposal workspace was resolved and snapshotted.
- The real proposal integration test generated both DOCX and PDF through the
  current template engine.
- DOCX deep-structure checks passed.
- PDF Chinese glyph validation passed.
- Frontend suite: 35 tests passed.
- Python suite: 109 tests passed.
- Production renderer build passed.

## Acceptance boundary

This evidence proves automated source resolution, immutable export input,
structural DOCX validation, PDF generation, and Chinese glyph validity. It does
not prove full-page visual inspection or target-editor acceptance. Microsoft
Word/WPS verification remains a separate later gate.
