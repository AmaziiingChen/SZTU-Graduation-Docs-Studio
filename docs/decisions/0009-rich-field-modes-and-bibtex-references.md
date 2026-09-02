# 0009 — Rich-field modes and BibTeX references

## Status

Accepted on 2026-08-30.

## Context

The structured editor introduced by ADR 0008 initially covered body fields, while
some titles, proposal paragraphs, outline titles, and task-schedule content still
used unrelated text inputs. That split made the same bold, italic, subscript, and
superscript semantics available in only some document fields. A global sidebar
shortcut also claimed <kbd>Command-B</kbd>/<kbd>Control-B</kbd>, which conflicts
with the conventional bold command inside an editor.

References have a different authoring problem. Users normally copy BibTeX from a
bibliographic database and should not have to reproduce punctuation, author order,
publication type markers, or inline scientific notation by hand. Raw BibTeX is
useful editing source, but it is not part of any strict process-document contract
and must not reach a Word, PDF, or LaTeX renderer directly.

## Decision

1. One restricted structured-content engine serves three semantic modes:
   - `inline` represents exactly one paragraph. It supports the contract-backed
     inline marks but not line breaks or lists. It is used for document titles,
     outline-item titles, and task-schedule content.
   - `paragraphs` represents one or more independent paragraphs with inline marks,
     but no list structure. It is used where the official form expects paragraph
     prose rather than a body outline.
   - `body` represents paragraphs plus ordered and unordered lists nested to at
     most four levels, as established by ADR 0008.
2. These modes change editing behavior, not the canonical data model. Canonical
   values remain strings or repository-owned rich paragraphs and content blocks.
   Editor JSON, HTML, DOM state, and Markdown are never renderer inputs.
3. The application sidebar has no global keyboard shortcut. Sidebar trigger and
   rail controls remain available, while <kbd>Command-B</kbd>/<kbd>Control-B</kbd>
   is reserved for bold in the focused structured editor.
4. BibTeX is parsed locally. A successful parse produces deterministic,
   repository-owned reference paragraphs for content checking, preview, and
   strict export. The formatted references are read-only output of the import
   step rather than a second manually maintained citation source. Unsupported
   TeX commands block import only when they occur in fields that can enter the
   formatted reference; source-only metadata such as `abstract`, `file`, and
   `keywords` remains preserved in the local draft without affecting validation.
   Common scientific commands such as `\textcelsius` and math-mode `\mu` are
   normalized to their Unicode symbols before structured output is generated.
5. Raw BibTeX is draft-only editor state under
   `payload.editor_state.bibliography`, with the source format, source text, parse
   status, and entry count. Only proposal and task-book drafts may carry this
   state. Before checking, previewing, or exporting, the application validates
   that state, rejects invalid input, constructs the strict document, and removes
   `editor_state`. Raw BibTeX is not sent to a document renderer or retained in
   the strict export-input snapshot.
6. The strict proposal and task-book schemas remain the export boundary. They
   accept only generated reference paragraphs and do not accept `editor_state` or
   raw BibTeX. A successful draft-schema validation still does not mean the draft
   is export-ready.

## Compatibility and migration

- Existing plain strings remain valid canonical values for inline and paragraph
  fields. They are upgraded to rich paragraphs only when formatting is added.
- Existing directory entries retain `level`, optional `number`, and a string or
  rich-paragraph `title`. Existing task-schedule entries retain `period` and a
  string or rich-paragraph `content`. Draft entries may be incomplete, but unknown
  properties and arbitrary objects are rejected instead of being silently saved.
- Existing formatted reference arrays without BibTeX remain readable and
  exportable. Pasting BibTeX establishes a new editing source only after it parses
  successfully; an invalid paste remains visible for correction and cannot replace
  the last valid structured references or enter export.
- Legacy allowlisted Markdown may be converted through the ADR 0008 compatibility
  adapter. Migration is performed in memory, validated against the target draft
  and strict document schemas, and written atomically. On failure, the original
  draft is retained and export is blocked rather than partially rewriting content.

## Consequences

- A formatting command is enabled only when every active strict schema and
  renderer can represent it.
- Directory and task-schedule draft arrays now have typed items even though their
  fields remain optional during autosave.
- BibTeX parser and formatter behavior requires fixtures for multiple entries,
  braces and quoted values, unsupported entry types, duplicate keys, malformed
  input, partial errors, and subscript or superscript preservation.
- Editor interaction tests must cover the three modes, Chinese IME composition,
  focus and selection, and the absence of a sidebar shortcut collision.
- Word/WPS visual verification remains a separate acceptance gate; neither an
  editor view nor a generated PDF preview establishes it.
