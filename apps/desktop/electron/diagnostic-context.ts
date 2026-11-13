export type DiagnosticContext = {
  stage?: string
  tool?: string
  tool_source?: string
  tool_version?: string
  template_source?: string
  exit_code?: number
  reason?: string
  http_status?: number
  check_id?: string
  request_id?: string
  document_type?: string
  template_version?: string
  field?: string
  trace?: Array<{ module: string; line: number }>
  structure?: Record<string, number>
}
const CONTRACT = {"document_types": ["proposal", "task_book", "midterm", "advisor_review", "reviewer_review", "defense_record", "grade_assessment", "thesis"], "modules": ["protocol.py", "exporter.py", "docx_inspector.py", "template_engine.py", "storage.py", "validation.py", "environment.py", "database.py", "workspace.py", "profiles.py", "profile_drafts.py", "documents.py"], "field_tokens": ["basic_content_and_requirements", "required_materials", "comments", "division_of_work", "suggested_grade", "final_grade", "date", "main_research_content", "significance_and_status", "methods_and_means", "research_steps", "research_content_intro", "methods_and_means_intro", "research_steps_intro", "graduation_year", "check_date", "questions", "answers", "members", "writing_guidance", "editable_headings", "basic_content", "project", "project_number", "other_level", "metadata", "sections", "title", "student_id", "student_name", "college", "major", "class_name", "advisor", "advisor_title", "background", "significance", "research_content", "methods", "references", "schedule", "period", "content", "columns", "header", "rows", "cells", "caption", "items", "runs", "text", "script", "bold", "italic", "directory", "progress", "problems", "guidance", "basis", "requirements", "objectives", "technical_requirements", "work_content", "research_methods", "plan", "expected_results", "introduction", "conclusion", "body", "paragraphs", "tables", "figures", "alt", "data", "document", "assessment", "overall_score", "evaluation", "opinion"], "counts": ["paragraphs", "tables", "rows", "columns", "images", "runs"]}
export function validDiagnosticContext(value: unknown): value is DiagnosticContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as DiagnosticContext;
  return validate(candidate);
}
function validate(value: DiagnosticContext): boolean {
  const allowed = ['stage', 'request_id', 'document_type', 'field', 'trace', 'structure', 'template_version', 'tool', 'tool_source', 'tool_version', 'template_source', 'exit_code', 'reason', 'http_status', 'check_id'];
  if (Object.keys(value).some(key => !allowed.includes(key))) return false;
  if (value.stage !== undefined && !["request", "content_validation", "external_render", "pdf_validation", "glyph_validation", "docx_inspection", "preview", "export", "storage", "template", "environment_probe", "workspace_open", "profile_save", "draft_save", "document_create", "document_select", "document_list", "snapshot", "export_input", "export_preflight", "preview_cache", "preview_publish", "pdf_structure", "pdf_fonts", "preview_rasterize", "word_render", "pdf_compile", "latex_source", "output_write", "preview_verify", "manifest_fetch", "manifest_verify", "platform_match", "update_download", "update_verify", "update_write", "report_prepare", "report_send", "report_receipt", "migration", "database_open", "profile_select", "profile_list", "render_input_write", "environment_font_discovery", "environment_python", "environment_temp", "environment_dependencies", "environment_tex_tool", "environment_tex_packages", "environment_pdf_tools", "environment_fonts", "environment_editor", "environment_template"].includes(value.stage)) return false;
  if (value.tool !== undefined && !["python_renderer", "xelatex", "pdfinfo", "pdffonts", "pdftoppm", "other"].includes(value.tool)) return false;
  if (value.tool_source !== undefined && !["bundled", "system", "unresolved"].includes(value.tool_source)) return false;
  if (value.tool_version !== undefined && (typeof value.tool_version !== "string" || !/^\d{1,5}(?:\.\d{1,10}){1,4}$/.test(value.tool_version))) return false;
  if (value.template_source !== undefined && !["development-workspace", "environment-workspace", "linked-workspace", "bundled", "installed", "installed-workspace", "environment", "builtin", "builtin-engine", "builtin-template-pack", "bundled-engine"].includes(value.template_source)) return false;
  if (value.exit_code !== undefined && (!Number.isInteger(value.exit_code) || value.exit_code < -2147483648 || value.exit_code > 4294967295)) return false;
  if (value.http_status !== undefined && (!Number.isInteger(value.http_status) || value.http_status < 100 || value.http_status > 599)) return false;
  if (value.check_id !== undefined && !["python", "temporary_directory", "document_dependencies", "xelatex", "pdf_tools", "process_tex_packages", "thesis_toolchain", "thesis_tex_packages", "core_document_fonts", "special_document_fonts", "task_book_docx_font", "office_editor", "template_pack", "thesis_template", "proposal_engine", "midterm_engine", "task_book_engine", "advisor_review_engine", "reviewer_review_engine", "defense_record_engine", "grade_assessment_engine"].includes(value.check_id)) return false;
  if (value.reason !== undefined && !["permission_denied", "file_missing", "disk_full", "path_too_long", "io_error", "dependency_missing", "font_unavailable", "tex_input_rejected", "output_write_failed", "tool_nonzero", "tool_start_failed", "tool_timeout", "cancel_requested", "cache_hit", "cache_miss", "network_failure", "http_rejected", "receipt_invalid", "signature_invalid", "artifact_unavailable", "transfer_failed", "size_mismatch", "hash_mismatch", "interrupted"].includes(value.reason)) return false;
  if (value.request_id !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.request_id)) return false;
  if (value.document_type !== undefined && !CONTRACT.document_types.includes(value.document_type)) return false;
  if (value.template_version !== undefined && (typeof value.template_version !== 'string' || !/^\d{1,4}\.\d{1,4}(?:\.\d{1,4})?(?:\+(?:workspace\.)?[0-9a-f]{7,64})?$/.test(value.template_version))) return false;
  if (value.field !== undefined) {
    if (typeof value.field !== 'string' || value.field.length > 240 || !/^[a-z_]+(?:\[\d{1,4}\])?(?:\.[a-z_]+(?:\[\d{1,4}\])?)*$/.test(value.field)) return false;
    if (value.field.replace(/\[\d+\]/g, '').split('.').some(token => !CONTRACT.field_tokens.includes(token))) return false;
  }
  if (value.trace !== undefined && (!Array.isArray(value.trace) || value.trace.length > 8 || value.trace.some(frame => !frame || Object.keys(frame).sort().join(',') !== 'line,module' || !CONTRACT.modules.includes(frame.module) || !Number.isInteger(frame.line) || frame.line < 1 || frame.line > 100000))) return false;
  if (value.structure !== undefined && (!value.structure || typeof value.structure !== 'object' || Array.isArray(value.structure) || Object.entries(value.structure).some(([key, count]) => !CONTRACT.counts.includes(key) || typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > 100000))) return false;
  return true;
}

export function diagnosticContext(input: unknown): DiagnosticContext {
  if (!input || typeof input !== "object") return {}
  const result: DiagnosticContext = {}
  for (const [key, value] of Object.entries(input)) {
    if (validDiagnosticContext({ [key]: value })) Object.assign(result, { [key]: value })
  }
  return result
}

export function documentStructure(input: unknown): Record<string, number> {
  const counts = { paragraphs: 0, tables: 0, rows: 0, columns: 0, images: 0, runs: 0 }
  let visited = 0
  function visit(value: unknown, depth: number): void {
    if (++visited > 20000 || depth > 30 || !value || typeof value !== "object") return
    if (Array.isArray(value)) { for (const child of value) { if (typeof child === "string" && child.trim()) counts.paragraphs++; else visit(child, depth + 1) } return }
    const item = value as Record<string, unknown>
    if (item.type === "paragraph") counts.paragraphs++
    if ((item.type === "table" || item.type === "data_table")) {
      counts.tables++
      if (Array.isArray(item.rows)) counts.rows += item.rows.length
      if (Array.isArray(item.columns)) counts.columns += item.columns.length
    }
    if (item.type === "figure_group" && Array.isArray(item.items)) counts.images += item.items.length
    if (item.type === "figure" || item.type === "image") counts.images++
    if (Array.isArray(item.runs)) counts.runs += item.runs.length
    for (const child of Object.values(item)) visit(child, depth + 1)
  }
  visit(input, 0)
  return counts
}
