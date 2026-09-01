import type { StructuredBodyValue } from "@/types/structured-content"

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export type JsonObject = { [key: string]: JsonValue }

export type EnvironmentCheck = {
  id: string
  required: boolean
  status: "pass" | "warn" | "fail"
  message: string
  details?: Record<string, unknown>
}

export type EnvironmentResult = {
  ready: boolean
  platform: {
    system: string
    release: string
    machine: string
    python: string
  }
  checks: EnvironmentCheck[]
}

export type AppInfo = {
  appVersion: string
  electronVersion: string
  platform: string
}

export type DiagnosticSummary = {
  reportId: string
  createdAt: string
  sizeBytes: number
  operationCount: number
  environmentCheckCount: number
  sourceFieldsRemoved: number
  privacyStatus: "passed"
}

export type DiagnosticSaveResult = {
  saved: boolean
}

export type PrivacyNoticeStatus = {
  noticeVersion: string
  acknowledged: boolean
  acceptedAt: string | null
  telemetryConfigured: boolean
  updateConfigured: boolean
  configurationRequired: boolean
}

export type TelemetryUsageEvent =
  | {
      name: "view_opened"
      view: "profile" | "proposal" | "task_book" | "midterm" | "inspection"
    }
  | {
      name: "document_action"
      action: "check" | "preview" | "template_sync" | "export" | "qa_record"
      documentType: DocumentType
      outcome: "success" | "failure" | "cancelled"
      errorCode?: string
      formatCount?: number
    }

export type UpdateStatus =
  | { state: "unconfigured" }
  | { state: "idle" }
  | { state: "checking" }
  | { state: "up_to_date"; checkedAt: string }
  | { state: "downloading"; version: string }
  | { state: "downloaded"; version: string; downloadedAt: string }
  | {
      state: "error"
      code: "CHECK_FAILED" | "MANIFEST_INVALID" | "DOWNLOAD_FAILED"
    }

export type WorkspaceMode = "persistent" | "temporary"
export type DocumentType = "proposal" | "task_book" | "midterm"
export type ToolLinkId =
  | "xmind"
  | "draw-io"
  | "simpletex"
  | "seekall"
  | "vcaptions"
  | "voyager"
  | "immersive-translate"
  | "easyscholar"
  | "tabbit"
  | "deepl"
  | "islide"
  | "zotero"
  | "metaso"
  | "perplexity"
  | "deepseek"
  | "doubao"
  | "qianwen"
  | "gemini"

export type StudentProfileInput = {
  id?: string
  full_name: string
  student_number: string
  college: string
  major: string
  class_name?: string | null
  advisor_name?: string | null
  advisor_title?: string | null
  graduation_cohort?: string | null
  thesis_title?: StructuredBodyValue | null
}

export type StudentProfile = {
  id: string
  full_name: string
  student_number: string
  college: string
  major: string
  class_name: string | null
  advisor_name: string | null
  advisor_title: string | null
  graduation_cohort: string | null
  thesis_title: StructuredBodyValue | null
  created_at: string
  updated_at: string
}

export type StudentProfileDraft = {
  full_name: string
  student_number: string
  college: string
  major: string
  class_name: string
  advisor_name: string
  advisor_title: string
  graduation_cohort: string
  thesis_title: StructuredBodyValue | null
}

export type DocumentInput = {
  profile_id?: string | null
  document_type: DocumentType
  template_version: string
  schema_version: string
  title: string
  source_document_id?: string
}

export type DocumentRecord = {
  id: string
  profile_id: string | null
  document_type: string
  template_version: string
  schema_version: string
  title: string
  status: string
  is_temporary: boolean
  current_revision: number
  content: JsonObject | null
  save_reason: "auto" | "manual" | "restore" | "import" | null
  saved_at: string | null
  created_at: string
  updated_at: string
  soft_deleted_at?: string | null
  restored_from_revision?: number
}

export type WorkspaceState = {
  mode: WorkspaceMode
  profile: StudentProfile | null
  profile_draft: StudentProfileDraft | null
  document: DocumentRecord | null
  documents: DocumentRecord[]
  deleted_documents: DocumentRecord[]
}

export type RenameDocumentInput = {
  documentId: string
  title: string
}

export type SaveDraftInput = {
  documentId: string
  content: JsonObject
  expectedRevision: number
  reason?: "auto" | "manual"
}

export type SaveDraftResult = {
  document_id: string
  revision: number
  save_reason: "auto" | "manual"
  saved_at: string
}

export type ExportFormat = "docx" | "pdf" | "tex"

export type CheckResult = {
  schema_version: "1.0"
  check_id: string
  gate:
    | "structure"
    | "cjk_glyph"
    | "full_page_layout"
    | "target_editor"
    | "content"
    | "template_integrity"
    | "environment"
  status: "not_checked" | "running" | "pass" | "warn" | "fail" | "blocked"
  blocking: boolean
  message: string
  code?: string
  details?: Record<string, unknown>
  checked_at?: string | null
}

export type DocumentCheckResult = {
  checks: CheckResult[]
}

export type PreviewGenerateInput = {
  requestId: string
  documentId: string
}

export type PreviewPage = {
  page_number: number
  sha256: string
  size_bytes: number
  data_url: string
}

export type PreviewResult = {
  schema_version: "1.0"
  preview_id: string
  document_id: string
  document_revision: number
  input_sha256: string
  template: {
    template_id: string
    version: string
    pack_sha256: string
  }
  pages: PreviewPage[]
  checks: CheckResult[]
  generated_at: string
}

export type ExportArtifact = {
  format: ExportFormat
  path: string
  sha256: string
  size_bytes: number
}

export type ExportReceipt = {
  schema_version: "1.0"
  export_id: string
  request_id: string
  status: "succeeded" | "partial" | "failed"
  template: {
    template_id: string
    version: string
    pack_sha256: string
  }
  input_sha256: string
  artifacts: ExportArtifact[]
  checks: CheckResult[]
  generated_at: string
}

export type ExportDocumentInput = {
  requestId: string
  documentId: string
  previewId: string
  outputDirectory: string
  formats: ExportFormat[]
  overwriteConfirmed: boolean
  preflightToken: string
}

export type ExportPreflightInput = {
  documentId: string
  previewId: string
  formats: ExportFormat[]
  outputDirectory: string
}

export type ExportPreflightResult = {
  schema_version: "1.0"
  ready: true
  document_id: string
  document_revision: number
  formats: ExportFormat[]
  input_sha256: string
  template: ExportReceipt["template"]
  targets: Array<{
    format: ExportFormat
    filename: string
    path: string
    exists: boolean
  }>
  overwrite_required: boolean
  checks: CheckResult[]
  blocking_codes: string[]
  preflight_token: string
  expires_at: string
}

export type ExportJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"

export type ExportArtifactRecord = {
  artifact_id: string
  format: ExportFormat
  display_name: string
  sha256: string
  size_bytes: number
  file_state: "available" | "missing" | "modified"
  replaced_existing: boolean
  checks: CheckResult[]
}

export type ExportJobSummary = {
  export_id: string
  request_id: string | null
  status: ExportJobStatus
  progress: number
  error_code: string | null
  requested_formats: ExportFormat[]
  input_sha256: string | null
  template: ExportReceipt["template"] | null
  snapshot_available: boolean
  overwrite_confirmed: boolean
  artifacts: ExportArtifactRecord[]
  created_at: string
  completed_at: string | null
}

export type ExportHistoryInput = {
  documentId: string
  limit?: number
}

export type ExportHistoryResult = {
  schema_version: "1.0"
  history: ExportJobSummary[]
}

export type ExportCancelResult = {
  request_id: string
  accepted: boolean
  status: "cancel_requested" | "not_running"
  cancel_requested_at: string | null
}

export type RevealArtifactResult = {
  artifact_id: string
  revealed: true
}

export type DeleteExportHistoryInput = {
  documentId: string
  exportId: string
}

export type DeleteExportHistoryResult = {
  export_id: string
  deleted: true
}

export type TemplateInstallResult = {
  status: "linked" | "updated" | "already_current"
  template_id: string
  version: string
  pack_sha256: string
  installed_at: string
  source: "linked-workspace"
}

export type RecordQaInput =
  | {
      exportId: string
      artifactId?: string
      gate: "full_page_layout"
      status: "pass" | "fail"
      message: string
    }
  | {
      artifactId: string
      gate: "target_editor"
      editor: "word" | "wps"
      status: "pass" | "fail"
      message: string
    }

export type RecordQaResult = {
  record_id: string
  export_id: string
  artifact_id: string | null
  check: CheckResult
  recorded_at: string
}

export type SztuDesktopApi = {
  getAppInfo: () => Promise<AppInfo>
  checkEnvironment: () => Promise<EnvironmentResult>
  prepareDiagnosticReport: () => Promise<DiagnosticSummary>
  saveDiagnosticReport: (reportId: string) => Promise<DiagnosticSaveResult>
  getPrivacyNoticeStatus: () => Promise<PrivacyNoticeStatus>
  acceptPrivacyNotice: () => Promise<PrivacyNoticeStatus>
  quitApp: () => Promise<null>
  recordTelemetry: (input: TelemetryUsageEvent) => Promise<null>
  getUpdateStatus: () => Promise<UpdateStatus>
  revealDownloadedUpdate: () => Promise<null>
  openToolLink: (toolId: ToolLinkId) => Promise<null>
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void
  openWorkspace: (mode: WorkspaceMode) => Promise<WorkspaceState>
  saveProfileDraft: (profile: StudentProfileDraft) => Promise<StudentProfileDraft>
  saveProfile: (profile: StudentProfileInput) => Promise<StudentProfile>
  createDocument: (document: DocumentInput) => Promise<DocumentRecord>
  selectDocument: (documentId: string) => Promise<WorkspaceState>
  renameDocument: (input: RenameDocumentInput) => Promise<WorkspaceState>
  deleteDocument: (documentId: string) => Promise<WorkspaceState>
  restoreDocument: (documentId: string) => Promise<WorkspaceState>
  purgeDocument: (documentId: string) => Promise<WorkspaceState>
  saveDraft: (input: SaveDraftInput) => Promise<SaveDraftResult>
  closeTemporary: (documentId: string) => Promise<WorkspaceState>
  checkDocument: (documentId: string) => Promise<DocumentCheckResult>
  generatePreview: (input: PreviewGenerateInput) => Promise<PreviewResult>
  chooseExportDirectory: () => Promise<string | null>
  preflightExport: (input: ExportPreflightInput) => Promise<ExportPreflightResult>
  exportDocument: (input: ExportDocumentInput) => Promise<ExportReceipt>
  cancelExport: (requestId: string) => Promise<ExportCancelResult>
  listExportHistory: (input: ExportHistoryInput) => Promise<ExportHistoryResult>
  revealExportArtifact: (artifactId: string) => Promise<RevealArtifactResult>
  deleteExportHistory: (input: DeleteExportHistoryInput) => Promise<DeleteExportHistoryResult>
  installTemplatePack: (documentType: DocumentType) => Promise<TemplateInstallResult | null>
  recordQa: (input: RecordQaInput) => Promise<RecordQaResult>
}
