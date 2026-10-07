const CONTRACT = {"document_types": ["proposal", "task_book", "midterm", "advisor_review", "reviewer_review", "defense_record", "grade_assessment", "thesis"], "modules": ["protocol.py", "exporter.py", "docx_inspector.py", "template_engine.py", "storage.py", "validation.py"], "field_tokens": ["basic_content_and_requirements", "required_materials", "comments", "division_of_work", "suggested_grade", "final_grade", "date", "main_research_content", "significance_and_status", "methods_and_means", "research_steps", "research_content_intro", "methods_and_means_intro", "research_steps_intro", "graduation_year", "check_date", "questions", "answers", "members", "writing_guidance", "editable_headings", "basic_content", "project", "project_number", "other_level", "metadata", "sections", "title", "student_id", "student_name", "college", "major", "class_name", "advisor", "advisor_title", "background", "significance", "research_content", "methods", "references", "schedule", "period", "content", "columns", "header", "rows", "cells", "caption", "items", "runs", "text", "script", "bold", "italic", "directory", "progress", "problems", "guidance", "basis", "requirements", "objectives", "technical_requirements", "work_content", "research_methods", "plan", "expected_results", "introduction", "conclusion", "body", "paragraphs", "tables", "figures", "alt", "data", "document", "assessment", "overall_score", "evaluation", "opinion"], "counts": ["paragraphs", "tables", "rows", "columns", "images", "runs"]};
function validDiagnosticContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const allowed = ['stage', 'request_id', 'document_type', 'field', 'trace', 'structure', 'template_version'];
  if (Object.keys(value).some(key => !allowed.includes(key))) return false;
  if (value.stage !== undefined && !["request", "content_validation", "external_render", "pdf_validation", "glyph_validation", "docx_inspection", "preview", "export", "storage", "template"].includes(value.stage)) return false;
  if (value.request_id !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.request_id)) return false;
  if (value.document_type !== undefined && !CONTRACT.document_types.includes(value.document_type)) return false;
  if (value.template_version !== undefined && (typeof value.template_version !== 'string' || !/^\d{1,4}\.\d{1,4}(?:\.\d{1,4})?(?:\+(?:workspace\.)?[0-9a-f]{7,64})?$/.test(value.template_version))) return false;
  if (value.field !== undefined) {
    if (typeof value.field !== 'string' || value.field.length > 240 || !/^[a-z_]+(?:\[\d{1,4}\])?(?:\.[a-z_]+(?:\[\d{1,4}\])?)*$/.test(value.field)) return false;
    if (value.field.replace(/\[\d+\]/g, '').split('.').some(token => !CONTRACT.field_tokens.includes(token))) return false;
  }
  if (value.trace !== undefined && (!Array.isArray(value.trace) || value.trace.length > 8 || value.trace.some(frame => !frame || Object.keys(frame).sort().join(',') !== 'line,module' || !CONTRACT.modules.includes(frame.module) || !Number.isInteger(frame.line) || frame.line < 1 || frame.line > 100000))) return false;
  if (value.structure !== undefined && (!value.structure || typeof value.structure !== 'object' || Array.isArray(value.structure) || Object.entries(value.structure).some(([key, count]) => !CONTRACT.counts.includes(key) || !Number.isInteger(count) || count < 0 || count > 100000))) return false;
  return true;
}
module.exports = { validDiagnosticContext };
